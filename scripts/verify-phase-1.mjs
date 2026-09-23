/**
 * Phase 1 verification against a real TeamSpeak server.
 *
 * The resilience items from docs/phase-1-remaining.md that need a live server
 * rather than a unit test: that a replayed connect really lands you back in the
 * channel you were in, that the hub's heartbeat reaps a frozen tab's TeamSpeak
 * client, and what the server does with a replayed connect on the same identity.
 *
 * Run it from the repo root with the hub running:
 *
 *   node scripts/verify-phase-1.mjs                         # hub :8080, ts localhost:9987
 *   node scripts/verify-phase-1.mjs --hub http://127.0.0.1:8080 --ts my.server:9987
 *
 * The channel tests need somewhere to move to. Pass ServerQuery credentials and
 * the script makes its own scratch channels and removes them afterwards:
 *
 *   node scripts/verify-phase-1.mjs --query-pass <serveradmin password>
 *
 * Without them it falls back to whatever non-default channels already exist,
 * and skips the channel checks if there are none.
 */
import WebSocket from "ws";
import net from "node:net";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const HUB = argOf("hub", "http://127.0.0.1:8080").replace(/\/+$/, "");
const [TS_HOST, TS_PORT = "9987"] = argOf("ts", "localhost:9987").split(":");
const ORIGIN = argOf("origin", HUB);
const QUERY_PORT = Number(argOf("query-port", "10011"));
const QUERY_USER = argOf("query-user", "serveradmin");
const QUERY_PASS = argOf("query-pass", "");
const WS_URL = `${HUB.replace(/^http/, "ws")}/ws`;

const results = [];
const pass = (name, detail = "") => results.push(["PASS", name, detail]);
const fail = (name, detail = "") => results.push(["FAIL", name, detail]);
const skip = (name, detail = "") => results.push(["SKIP", name, detail]);
const check = (ok, name, detail = "") => (ok ? pass(name, detail) : fail(name, detail));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ----------------------------------------------------- ServerQuery (setup) */

/** Minimal ServerQuery client, only enough to make and remove scratch channels. */
async function query(commands) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: TS_HOST, port: QUERY_PORT });
    const out = [];
    let buf = "";
    let sent = 0;
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("ServerQuery timed out"));
    }, 15_000);
    sock.setEncoding("utf8");
    sock.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    sock.on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        // ServerQuery ends lines with "\n\r", so the carriage return leads the
        // *next* line; strip both ends rather than just a trailing one.
        const line = buf.slice(0, nl).replaceAll("\r", "").trim();
        buf = buf.slice(nl + 1);
        // The banner lines before the first prompt are not replies.
        if (line.startsWith("TS3") || line.startsWith("Welcome") || line === "") continue;
        if (line.startsWith("error ")) {
          out.push({ error: line, body: out.pendingBody ?? "" });
          out.pendingBody = undefined;
          if (sent < commands.length) sock.write(commands[sent++] + "\n");
          else {
            clearTimeout(timer);
            sock.end();
            resolve(out);
          }
        } else {
          out.pendingBody = line;
        }
      }
    });
    sock.on("connect", () => {
      // The server greets first; kick off with the first command.
      setTimeout(() => sock.write(commands[sent++] + "\n"), 300);
    });
  });
}

const qEscape = (s) =>
  String(s)
    .replaceAll("\\", "\\\\")
    .replaceAll("/", "\\/")
    .replaceAll(" ", "\\s")
    .replaceAll("|", "\\p");

const SCRATCH_TOP = "Phase1 Scratch";
const SCRATCH_SUB = "Nested";
/** A "/" in a channel name has to survive path building; this is the case for it. */
const SCRATCH_SLASH = "Phase1/Slash";

/** Creates "Phase1 Scratch" and a child "Nested"; returns their channel ids. */
async function makeScratchChannels() {
  if (!QUERY_PASS) return null;
  const replies = await query([
    `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
    "use sid=1",
    `channelcreate channel_name=${qEscape(SCRATCH_TOP)} channel_flag_permanent=1`,
  ]);
  const created = replies.at(-1);
  if (!created || !/error id=0/.test(created.error)) {
    // Already there from an earlier run: look it up instead.
    const found = await query([
      `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
      "use sid=1",
      `channelfind pattern=${qEscape(SCRATCH_TOP)}`,
    ]);
    const cid = /cid=(\d+)/.exec(found.at(-1)?.body ?? "")?.[1];
    if (!cid) return null;
    const sub = await query([
      `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
      "use sid=1",
      `channelfind pattern=${qEscape(SCRATCH_SUB)}`,
    ]);
    const subCid = /cid=(\d+)/.exec(sub.at(-1)?.body ?? "")?.[1];
    const slashFound = await query([
      `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
      "use sid=1",
      `channelfind pattern=${qEscape(SCRATCH_SLASH)}`,
    ]);
    const slashCid = /cid=(\d+)/.exec(slashFound.at(-1)?.body ?? "")?.[1];
    return { top: cid, sub: subCid ?? null, slash: slashCid ?? null };
  }
  const top = /cid=(\d+)/.exec(created.body ?? "")?.[1];
  if (!top) return null;
  const subReply = await query([
    `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
    "use sid=1",
    `channelcreate channel_name=${qEscape(SCRATCH_SUB)} channel_flag_permanent=1 cpid=${top}`,
  ]);
  const sub = /cid=(\d+)/.exec(subReply.at(-1)?.body ?? "")?.[1] ?? null;
  const slashReply = await query([
    `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
    "use sid=1",
    `channelcreate channel_name=${qEscape(SCRATCH_SLASH)} channel_flag_permanent=1 cpid=${top}`,
  ]);
  const slash = /cid=(\d+)/.exec(slashReply.at(-1)?.body ?? "")?.[1] ?? null;
  return { top, sub, slash };
}

async function removeScratchChannels(ids) {
  if (!QUERY_PASS || !ids?.top) return;
  await query([
    `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
    "use sid=1",
    `channeldelete cid=${ids.top} force=1`,
  ]).catch(() => undefined);
}

/* ------------------------------------------------------------- hub session */

/**
 * One websocket session, resolved once TeamSpeak reports it connected.
 * `opts.connect` is merged into the connect request; `opts.autoPong: false`
 * makes the socket ignore the hub's heartbeat, imitating a frozen tab.
 */
function connect(opts = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { origin: ORIGIN, autoPong: opts.autoPong !== false });
    const state = {
      ws,
      sessionId: "",
      uid: "",
      selfClientId: 0,
      channels: new Map(),
      clients: new Map(),
      left: [],
      errors: [],
    };
    const timer = setTimeout(() => reject(new Error("no `connected` within 30s")), 30_000);
    ws.on("error", reject);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "hello") {
        state.sessionId = msg.sessionId;
        ws.send(
          JSON.stringify({
            type: "connect",
            host: TS_HOST,
            port: Number(TS_PORT),
            nickname: opts.nickname ?? "Phase1Check",
            ...(opts.connect ?? {}),
          }),
        );
      }
      if (msg.type === "snapshot") {
        for (const ch of msg.channels) state.channels.set(ch.id, ch);
        for (const c of msg.clients) state.clients.set(c.id, c);
      }
      if (msg.type === "client.entered") state.clients.set(msg.client.id, msg.client);
      if (msg.type === "client.left") {
        const gone = state.clients.get(msg.clientId);
        state.clients.delete(msg.clientId);
        state.left.push({ clientId: msg.clientId, uid: gone?.uid, reasonId: msg.reasonId });
      }
      if (msg.type === "client.moved") {
        const c = state.clients.get(msg.clientId);
        if (c) c.channelId = msg.channelId;
      }
      if (msg.type === "connected") {
        state.uid = msg.uid;
        state.selfClientId = msg.selfClientId;
        state.identity = msg.identity;
      }
      if (msg.type === "error") {
        state.errors.push(msg);
        if (msg.fatal) {
          clearTimeout(timer);
          reject(new Error(`${msg.code}: ${msg.message}`));
        }
      }
      // The snapshot is what tells us where we landed, so wait for it.
      if (msg.type === "snapshot" && state.selfClientId) {
        clearTimeout(timer);
        setTimeout(() => resolve(state), 500);
      }
    });
  });
}

const myChannel = (s) => s.clients.get(s.selfClientId)?.channelId ?? null;
const nameOf = (s, cid) => s.channels.get(cid)?.name ?? `<${cid}>`;

/** The same path the web client builds for a replayed connect. */
function channelPath(channels, channelId) {
  const parts = [];
  const seen = new Set();
  let id = channelId;
  for (let i = 0; i < 64; i++) {
    const ch = channels.get(id);
    if (!ch || seen.has(id)) break;
    seen.add(id);
    parts.push(ch.name.replaceAll("/", "\\/"));
    id = ch.parentId;
  }
  return parts.reverse().join("/");
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    ws.on("close", resolve);
  });
}

/* --------------------------------------------------------------- the tests */

async function run() {
  console.log(`hub ${HUB}, teamspeak ${TS_HOST}:${TS_PORT}\n`);
  let scratch = null;
  try {
    scratch = await makeScratchChannels();
  } catch (err) {
    console.log(`ServerQuery setup failed (${err.message}); falling back to existing channels\n`);
  }

  const first = await connect();
  console.log(`connected as clid ${first.selfClientId}, uid ${first.uid}`);
  const home = myChannel(first);
  console.log(`landed in "${nameOf(first, home)}"\n`);

  // Somewhere that is not where a default connect puts us.
  const target =
    (scratch?.top && first.channels.get(scratch.top)) ??
    [...first.channels.values()].find((c) => c.id !== home);
  const nested = scratch?.sub ? first.channels.get(scratch.sub) : null;
  const slashed = scratch?.slash ? first.channels.get(scratch.slash) : null;

  if (!target) {
    skip("reconnect returns to the live channel", "no second channel on this server");
    skip("reconnect returns to a nested channel", "no second channel on this server");
    skip("replayed connect by channel id", "no second channel on this server");
  } else {
    /* -- 1. a replayed connect lands in the channel we were in ----------- */
    first.ws.send(JSON.stringify({ type: "moveTo", channelId: target.id }));
    await sleep(1_500);
    check(
      myChannel(first) === target.id,
      "moveTo puts us in the target channel",
      `now in "${nameOf(first, myChannel(first))}"`,
    );

    const path = channelPath(first.channels, target.id);
    const identity = first.identity;
    // Close the link the way a dropped gateway does, and let the server reap
    // the old client before the replay (it holds a clone limit per identity).
    first.ws.close();
    await waitForClose(first.ws);
    await sleep(2_000);

    const replay = await connect({ connect: { identity, defaultChannel: path } });
    check(
      myChannel(replay) === target.id,
      "a replayed connect returns to the live channel",
      `path "${path}" → "${nameOf(replay, myChannel(replay))}"`,
    );
    check(
      replay.uid === first.uid,
      "the replayed session keeps the same identity",
      `uid ${replay.uid}`,
    );

    /* -- 2. the same for a nested channel -------------------------------- */
    if (!nested) {
      skip("reconnect returns to a nested channel", "no nested scratch channel");
    } else {
      replay.ws.send(JSON.stringify({ type: "moveTo", channelId: nested.id }));
      await sleep(1_500);
      const nestedPath = channelPath(replay.channels, nested.id);
      replay.ws.close();
      await waitForClose(replay.ws);
      await sleep(2_000);
      const deep = await connect({ connect: { identity, defaultChannel: nestedPath } });
      check(
        myChannel(deep) === nested.id,
        "a replayed connect returns to a nested channel",
        `path "${nestedPath}" → "${nameOf(deep, myChannel(deep))}"`,
      );
      deep.ws.close();
      await waitForClose(deep.ws);
      await sleep(2_000);
    }

    /* -- 3. does the server accept "/<cid>" instead of a name path? ------ */
    const byId = await connect({ connect: { identity, defaultChannel: `/${target.id}` } });
    const landedById = myChannel(byId) === target.id;
    if (landedById) {
      pass("the server also accepts a channel id as the default channel", `/${target.id}`);
    } else {
      // Not a failure: it is why the client builds a name path instead.
      skip(
        "the server also accepts a channel id as the default channel",
        `"/${target.id}" landed in "${nameOf(byId, myChannel(byId))}"; the name path is the one to use`,
      );
    }
    byId.ws.close();
    await waitForClose(byId.ws);
    await sleep(2_000);

    /* -- 3b. a "/" inside a channel name must stay one path segment ------ */
    if (!slashed) {
      skip("a slash in a channel name survives the round trip", "no slash-named scratch channel");
    } else {
      const escaped = channelPath(first.channels, slashed.id);
      const esc = await connect({ connect: { identity, defaultChannel: escaped } });
      check(
        myChannel(esc) === slashed.id,
        "a slash in a channel name survives the round trip",
        `path "${escaped}" → "${nameOf(esc, myChannel(esc))}"`,
      );
      esc.ws.close();
      await waitForClose(esc.ws);
      await sleep(2_000);

      // And the same path unescaped must NOT land there, or the escaping is
      // pointless and `channelPath` should stop doing it.
      const raw = escaped.replaceAll("\\/", "/");
      const rawSession = await connect({ connect: { identity, defaultChannel: raw } });
      check(
        myChannel(rawSession) !== slashed.id,
        "the same path unescaped does not land there (so the escaping earns its keep)",
        `path "${raw}" → "${nameOf(rawSession, myChannel(rawSession))}"`,
      );
      rawSession.ws.close();
      await waitForClose(rawSession.ws);
      await sleep(2_000);
    }
  }

  /* -- 4. the heartbeat reaps a frozen tab's TeamSpeak client ------------- */
  const observer = await connect({ nickname: "Phase1Observer" });
  const ghost = await connect({ nickname: "Phase1Ghost", autoPong: false });
  const ghostUid = ghost.uid;
  const seenByObserver = [...observer.clients.values()].some((c) => c.uid === ghostUid);
  await sleep(2_000);
  check(
    seenByObserver || [...observer.clients.values()].some((c) => c.uid === ghostUid),
    "the observer sees the ghost's client on the server",
    `uid ${ghostUid}`,
  );

  // Two missed 20s heartbeats, plus room for the disconnect to reach the server.
  console.log("\nwaiting ~50s for the heartbeat to cull the silent socket...\n");
  await sleep(50_000);

  check(
    ghost.ws.readyState === WebSocket.CLOSED || ghost.ws.readyState === WebSocket.CLOSING,
    "the hub terminates a socket that stops ponging",
    `readyState ${ghost.ws.readyState}`,
  );
  const reaped = observer.left.some((l) => l.uid === ghostUid);
  const stillThere = [...observer.clients.values()].some((c) => c.uid === ghostUid);
  check(
    reaped && !stillThere,
    "the culled session's TeamSpeak client disappears from the server",
    reaped ? "observer saw it leave" : "observer never saw it leave — the ghost lingers",
  );

  observer.ws.close();
  await waitForClose(observer.ws);
  await removeScratchChannels(scratch);

  /* ------------------------------------------------------------- report */
  console.log();
  for (const [status, name, detail] of results) {
    console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(`\n${results.filter((r) => r[0] === "PASS").length} ok, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
