/**
 * A small TeamSpeak 3 ServerQuery client (raw TCP, default port 10011).
 *
 * One persistent connection with a command queue: the rig issues a few dozen
 * commands per run, and logging in for each one (as the older verify scripts
 * do) would trip the query flood protection much sooner.
 *
 *   const sq = await ServerQuery.connect({ host, port, user, password, sid: 1 });
 *   const [info] = await sq.send("serverinfo");
 *   await sq.cmd("channelcreate", { channel_name: "e2e x", cpid: 0 });
 *   sq.close();
 *
 * Responses are parsed into plain objects with unescaped string values; a
 * non-zero `error id=` rejects with a `QueryError` carrying the id.
 */
import net from "node:net";

/** ServerQuery's escaping: the order matters, backslash first. */
const ESCAPES = [
  ["\\", "\\\\"],
  ["/", "\\/"],
  [" ", "\\s"],
  ["|", "\\p"],
  ["\x07", "\\a"],
  ["\b", "\\b"],
  ["\f", "\\f"],
  ["\n", "\\n"],
  ["\r", "\\r"],
  ["\t", "\\t"],
  ["\v", "\\v"],
];

export function escape(value) {
  let s = String(value);
  for (const [raw, esc] of ESCAPES) s = s.replaceAll(raw, esc);
  return s;
}

const UNESCAPE = new Map(ESCAPES.map(([raw, esc]) => [esc[1], raw]));

export function unescape(value) {
  return value.replace(/\\(.)/g, (m, c) => UNESCAPE.get(c) ?? c);
}

/** `a=1 b=x\sy -flag` → `{ a: "1", b: "x y", flag: "" }`. */
export function parseRecord(line) {
  const out = {};
  for (const part of line.split(" ")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) out[part.replace(/^-/, "")] = "";
    else out[part.slice(0, eq)] = unescape(part.slice(eq + 1));
  }
  return out;
}

/** A data line holds one record per `|`. */
export function parseRecords(line) {
  return line.split("|").map(parseRecord);
}

/** `("clientkick", { clid: 3, reasonmsg: "bye" }, ["-force"])` → one command line. */
export function buildCommand(name, params = {}, flags = []) {
  const parts = [name];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    parts.push(`${k}=${escape(v)}`);
  }
  for (const f of flags) parts.push(f.startsWith("-") ? f : `-${f}`);
  return parts.join(" ");
}

export class QueryError extends Error {
  constructor(command, id, msg, extra) {
    super(
      `ServerQuery "${command.split(" ")[0]}" failed: ${msg} (id ${id})${extra ? ` — ${extra}` : ""}`,
    );
    this.name = "QueryError";
    this.id = id;
    this.queryMessage = msg;
  }
}

/** "client is flooding": the query login is not on the server's allowlist. */
const FLOOD = 524;
const FLOOD_RETRIES = 6;
const COMMAND_TIMEOUT_MS = 15_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ServerQuery {
  #sock;
  #buf = "";
  #data = [];
  /** FIFO of `{ line, resolve, reject, timer }`; only the head is on the wire. */
  #queue = [];
  #greeted;
  #closed = false;

  constructor(sock) {
    this.#sock = sock;
    sock.setEncoding("utf8");
    this.#greeted = new Promise((resolve, reject) => {
      this.#onGreeting = resolve;
      sock.once("error", reject);
    });
    sock.on("data", (chunk) => this.#onData(chunk));
    sock.on("error", (err) => this.#failAll(err));
    sock.on("close", () => {
      this.#closed = true;
      this.#failAll(new Error("ServerQuery connection closed"));
    });
  }

  #onGreeting = () => undefined;

  /** Opens a connection, logs in and selects the virtual server. */
  static async connect({ host = "127.0.0.1", port = 10011, user, password, sid = 1, nickname }) {
    const sock = net.createConnection({ host, port });
    const sq = new ServerQuery(sock);
    await sq.#greeted;
    if (user) await sq.cmd("login", { client_login_name: user, client_login_password: password });
    await sq.cmd("use", { sid });
    if (nickname) {
      // Cosmetic (shows who is poking the server in the logs); a taken name is fine.
      await sq.cmd("clientupdate", { client_nickname: nickname }).catch(() => undefined);
    }
    return sq;
  }

  #onData(chunk) {
    this.#buf += chunk;
    let nl;
    while ((nl = this.#buf.indexOf("\n")) >= 0) {
      // Lines end with "\n\r", so the carriage return leads the next line.
      const line = this.#buf.slice(0, nl).replaceAll("\r", "");
      this.#buf = this.#buf.slice(nl + 1);
      this.#onLine(line);
    }
  }

  #onLine(line) {
    if (line.startsWith("TS3")) return;
    if (line.startsWith("Welcome to the TeamSpeak")) {
      this.#onGreeting();
      return;
    }
    if (line === "" || line.startsWith("notify")) return;
    if (!line.startsWith("error ")) {
      this.#data.push(line);
      return;
    }
    const head = this.#queue.shift();
    const data = this.#data;
    this.#data = [];
    if (!head) return;
    clearTimeout(head.timer);
    const err = parseRecord(line.slice("error ".length));
    const id = Number(err.id);
    if (id === 0) head.resolve(data.flatMap(parseRecords));
    else head.reject(new QueryError(head.line, id, err.msg ?? "", err.extra_msg ?? ""));
    this.#pump();
  }

  #pump() {
    const head = this.#queue[0];
    if (!head || head.sent) return;
    head.sent = true;
    head.timer = setTimeout(() => {
      head.reject(new Error(`ServerQuery timed out on "${head.line.split(" ")[0]}"`));
      this.close();
    }, COMMAND_TIMEOUT_MS);
    this.#sock.write(head.line + "\n");
  }

  #failAll(err) {
    const pending = this.#queue;
    this.#queue = [];
    for (const p of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
  }

  #sendOnce(line) {
    if (this.#closed) return Promise.reject(new Error("ServerQuery connection is closed"));
    return new Promise((resolve, reject) => {
      this.#queue.push({ line, resolve, reject, sent: false, timer: null });
      this.#pump();
    });
  }

  /**
   * Sends one raw command line and resolves with its records. Flood errors
   * are retried with a growing pause (the default flood window is 3 s).
   */
  async send(line) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.#sendOnce(line);
      } catch (err) {
        if (!(err instanceof QueryError) || err.id !== FLOOD || attempt >= FLOOD_RETRIES) throw err;
        await sleep(1_100 * (attempt + 1));
      }
    }
  }

  /** `send`, with the parameters escaped for you. */
  cmd(name, params, flags) {
    return this.send(buildCommand(name, params, flags));
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#sock.write("quit\n");
    } catch {
      /* already gone */
    }
    this.#sock.end();
    this.#sock.destroy();
  }
}
