/**
 * M3 transfer core against a real TeamSpeak server: the hub's upload and
 * download routes, the read-only file commands, and the checks around them.
 *
 * Needs a running hub (a production build, so its memory can be watched) and
 * ServerQuery access to the TeamSpeak server, which it uses to make a
 * throwaway channel with a password and to put one of its two clients in
 * Server Admin. Everything it creates is deleted at the end (the channel
 * takes its files with it).
 *
 *   node scripts/verify-m3-transfer.mjs --hub http://127.0.0.1:8141 \
 *     --query-password '<serveradmin password>' --hub-pid <pid> --hub-log <file>
 *
 * Options: --ts host:port (localhost:9987), --query host:port (127.0.0.1:10011),
 * --big-mb 50 (the large upload), --origin (defaults to the hub's own).
 */
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import WebSocket from "ws";
import { ServerQuery } from "./e2e/lib/serverquery.mjs";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const HUB = argOf("hub", "http://127.0.0.1:8141").replace(/\/+$/, "");
const [TS_HOST, TS_PORT = "9987"] = argOf("ts", "localhost:9987").split(":");
const [Q_HOST, Q_PORT = "10011"] = argOf("query", "127.0.0.1:10011").split(":");
const Q_PASSWORD = argOf("query-password", process.env.E2E_QUERY_PASSWORD ?? "");
const HUB_PID = argOf("hub-pid", "");
const HUB_LOG = argOf("hub-log", "");
const BIG_MB = Number(argOf("big-mb", "50"));
const ORIGIN = argOf("origin", HUB);
/**
 * Growth allowed while streaming. Buffers churn faster than the collector
 * runs, so RSS rises some tens of MB whatever the file size; buffering the
 * file would show as growth in proportion to it (try --big-mb 200).
 */
const RSS_SLACK_MB = 100;
const RUN = `m3-${Date.now().toString(36).slice(-5)}`;
const CHANNEL_PW = `pw ${RUN} é`;

const results = [];
const check = (ok, name, detail = "") => {
  results.push([ok ? "PASS" : "FAIL", name, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

/* ------------------------------ hub sessions ------------------------------ */

function connect(nickname) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}/ws`, { origin: ORIGIN });
    const state = { ws, nickname, sessionId: "", uid: "", perms: {}, pending: new Map(), seq: 0 };
    const timer = setTimeout(() => reject(new Error(`${nickname}: no connect in 30 s`)), 30_000);
    ws.on("error", reject);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "hello") {
        state.sessionId = msg.sessionId;
        state.features = msg.features;
        ws.send(
          JSON.stringify({ type: "connect", host: TS_HOST, port: Number(TS_PORT), nickname }),
        );
      }
      if (msg.type === "perms")
        state.perms = msg.full ? msg.values : { ...state.perms, ...msg.values };
      if (msg.type === "ts.cmdResult") state.pending.get(msg.id)?.(msg);
      if (msg.type === "connected") {
        state.uid = msg.uid;
        clearTimeout(timer);
        setTimeout(() => resolve(state), 1_000);
      }
      if (msg.type === "error" && msg.fatal) reject(new Error(`${msg.code}: ${msg.message}`));
    });
  });
}

function tsCmd(state, cmd, cmdArgs) {
  const id = `v${++state.seq}`;
  return new Promise((resolve) => {
    state.pending.set(id, (msg) => {
      state.pending.delete(id);
      resolve(msg);
    });
    state.ws.send(JSON.stringify({ type: "ts.cmd", id, cmd, args: cmdArgs }));
  });
}

/* --------------------------------- HTTP ---------------------------------- */

/**
 * PUT an upload of `size` bytes from `chunks` (an async iterable), with
 * http.request so the Content-Length is ours and the upload can be cut off.
 */
function put(state, { cid, path, cpw, overwrite, size, chunks, headers = {}, abortAfter }) {
  const query = new URLSearchParams({ cid, path, ...(overwrite ? { overwrite: "1" } : {}) });
  const url = new URL(`/api/files/upload?${query}`, HUB);
  return new Promise((resolve) => {
    const req = http.request(url, {
      method: "PUT",
      headers: {
        origin: ORIGIN,
        "x-session-id": state.sessionId,
        "content-type": "application/octet-stream",
        ...(size === undefined ? {} : { "content-length": String(size) }),
        ...(cpw ? { "x-ts-channel-password": encodeURIComponent(cpw) } : {}),
        ...headers,
      },
    });
    req.on("response", (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, body: safeJson(body) }));
    });
    req.on("error", (err) => resolve({ status: 0, error: err.message }));
    let sent = 0;
    const source = Readable.from(chunks);
    source.on("data", (chunk) => {
      sent += chunk.length;
      if (abortAfter !== undefined && sent >= abortAfter) {
        source.destroy();
        req.destroy(new Error("cancelled by the test"));
        return;
      }
      if (!req.write(chunk)) {
        source.pause();
        req.once("drain", () => source.resume());
      }
    });
    source.on("end", () => req.end());
  });
}

const safeJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

async function ticket(state, body, origin = ORIGIN) {
  const res = await fetch(`${HUB}/api/files/download-ticket`, {
    method: "POST",
    headers: { origin, "x-session-id": state.sessionId, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Streams a download into a hash; never holds the file. */
async function fetchHashed(url) {
  const res = await fetch(`${HUB}${url}`);
  const hash = createHash("sha256");
  let size = 0;
  if (res.ok) {
    for await (const chunk of res.body) {
      hash.update(chunk);
      size += chunk.length;
    }
  }
  return { res, size, sha: hash.digest("hex") };
}

/** Random chunks (so nothing on the way can compress them), hashed as they are made. */
function* generated(total, hash, chunk = 256 * 1024) {
  for (let left = total; left > 0; left -= chunk) {
    const buf = randomBytes(Math.min(chunk, left));
    hash?.update(buf);
    yield buf;
  }
}

function rssMb() {
  if (!HUB_PID) return NaN;
  const status = readFileSync(`/proc/${HUB_PID}/status`, "utf8");
  return Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
}

function sampleRss() {
  const samples = [];
  const timer = setInterval(() => samples.push(rssMb()), 100);
  return () => {
    clearInterval(timer);
    return samples;
  };
}

/* ---------------------------------- run ---------------------------------- */

async function run() {
  if (!Q_PASSWORD) throw new Error("--query-password (or E2E_QUERY_PASSWORD) is required");
  const sq = await ServerQuery.connect({
    host: Q_HOST,
    port: Number(Q_PORT),
    user: "serveradmin",
    password: Q_PASSWORD,
    sid: 1,
  });
  const [{ cid }] = await sq.cmd("channelcreate", {
    channel_name: RUN,
    channel_password: CHANNEL_PW,
    channel_flag_semi_permanent: 1,
  });
  const admin = await connect(`${RUN}-admin`);
  const guest = await connect(`${RUN}-guest`);
  const dbIds = [];
  try {
    for (const s of [admin, guest]) {
      const [row] = await sq.cmd("clientgetdbidfromuid", { cluid: s.uid });
      dbIds.push(row.cldbid);
    }
    const groups = await sq.send("servergrouplist");
    const adminGroup = groups.find((g) => g.name === "Server Admin" && g.type === "1");
    await sq.cmd("servergroupaddclient", { sgid: adminGroup.sgid, cldbid: dbIds[0] });
    await new Promise((r) => setTimeout(r, 1_500));
    check(
      guest.features?.files?.maxUploadBytes > 0,
      "hello carries the file limits",
      JSON.stringify(guest.features?.files),
    );
    await checks({ admin, guest, cid: String(cid) });
  } finally {
    for (const s of [admin, guest]) s.ws.close();
    await new Promise((r) => setTimeout(r, 500));
    await sq.cmd("channeldelete", { cid, force: 1 }).catch(() => undefined);
    for (const cldbid of dbIds) await sq.cmd("clientdbdelete", { cldbid }).catch(() => undefined);
    sq.close();
  }
}

async function checks({ admin, guest, cid }) {
  const list = (s, path = "/", cpw = CHANNEL_PW) => tsCmd(s, "ftgetfilelist", { cid, path, cpw });

  /* ---- listing and passwords ---- */
  const wrongList = await list(guest, "/", "nope");
  check(
    !wrongList.ok && wrongList.code === "781",
    "ftgetfilelist, wrong password: 781",
    wrongList.message,
  );
  const emptyList = await list(guest);
  check(emptyList.ok && emptyList.rows.length === 0, "ftgetfilelist on an empty channel: no rows");

  /* ---- a small upload, listed and downloaded by someone else ---- */
  const small = Buffer.from(`hello from ${RUN}\n`);
  const up = await put(admin, {
    cid,
    path: "/报告 1.txt",
    cpw: CHANNEL_PW,
    size: small.length,
    chunks: [small],
  });
  check(up.status === 201, "admin uploads a small file", `${up.status} ${JSON.stringify(up.body)}`);
  const listed = await list(guest);
  const row = listed.rows?.find((r) => r.name === "报告 1.txt");
  check(
    !!row && row.size === String(small.length) && row.type === "1",
    "guest lists it (notifyfilelist: name, size, type=1)",
    JSON.stringify(listed.rows),
  );
  const info = await tsCmd(guest, "ftgetfileinfo", { cid, name: "/报告 1.txt", cpw: CHANNEL_PW });
  check(
    info.ok && info.rows[0]?.size === String(small.length),
    "ftgetfileinfo answers notifyfileinfo",
    JSON.stringify(info.rows ?? info.message),
  );
  const missingInfo = await tsCmd(guest, "ftgetfileinfo", { cid, name: "/nope", cpw: CHANNEL_PW });
  check(
    !missingInfo.ok,
    "ftgetfileinfo on a missing file fails",
    `${missingInfo.code} ${missingInfo.message}`,
  );

  const badTicket = await ticket(guest, { cid, path: "/报告 1.txt", cpw: "nope" });
  check(
    badTicket.status === 403 && badTicket.body?.message === "tsErr.channelPassword",
    "download with a wrong channel password is refused",
    `${badTicket.status} ${JSON.stringify(badTicket.body)}`,
  );
  const missing = await ticket(guest, { cid, path: "/nope.txt", cpw: CHANNEL_PW });
  check(missing.status === 404, "download of a missing file: 404", JSON.stringify(missing.body));

  const good = await ticket(guest, { cid, path: "/报告 1.txt", cpw: CHANNEL_PW });
  check(
    good.status === 200 && good.body.size === small.length,
    "guest gets a download link",
    JSON.stringify(good.body),
  );
  const got = await fetchHashed(good.body.url);
  check(
    got.res.status === 200 && got.sha === createHash("sha256").update(small).digest("hex"),
    "the download has the uploaded bytes",
  );
  check(
    got.res.headers.get("content-disposition")?.startsWith("attachment;") &&
      got.res.headers.get("x-content-type-options") === "nosniff" &&
      got.res.headers.get("content-type") === "application/octet-stream" &&
      got.res.headers.get("content-length") === String(small.length),
    "download headers: attachment, nosniff, octet-stream, length",
    got.res.headers.get("content-disposition"),
  );
  const reused = await fetch(`${HUB}${good.body.url}`);
  check(reused.status === 410, "a download link works once", `HTTP ${reused.status}`);

  /* ---- refusals ---- */
  const guestUp = await put(guest, {
    cid,
    path: "/g.txt",
    cpw: CHANNEL_PW,
    size: 3,
    chunks: [Buffer.from("abc")],
  });
  check(
    guestUp.status === 403 && guestUp.body?.failedPermission === "i_ft_needed_file_upload_power",
    "guest upload is refused naming the permission",
    JSON.stringify(guestUp.body),
  );
  const bigGuest = await put(guest, {
    cid,
    path: "/g.bin",
    cpw: CHANNEL_PW,
    size: 20 * 1024 * 1024,
    chunks: generated(20 * 1024 * 1024),
  });
  check(
    bigGuest.status === 403 && bigGuest.body?.error === "2568",
    "…also for a 20 MB file (the refusal reaches the client, not a broken pipe)",
    `${bigGuest.status} ${bigGuest.error ?? ""}`,
  );
  const exists = await put(admin, {
    cid,
    path: "/报告 1.txt",
    cpw: CHANNEL_PW,
    size: 3,
    chunks: [Buffer.from("abc")],
  });
  check(
    exists.status === 409 && exists.body?.error === "2050",
    "upload over an existing file without overwrite: 409",
    JSON.stringify(exists.body),
  );
  const over = await put(admin, {
    cid,
    path: "/报告 1.txt",
    cpw: CHANNEL_PW,
    overwrite: true,
    size: 3,
    chunks: [Buffer.from("abc")],
  });
  check(over.status === 201, "…and with overwrite=1 it replaces it", JSON.stringify(over.body));
  const wrongPwUp = await put(guest, {
    cid,
    path: "/x.txt",
    cpw: "nope",
    size: 1,
    chunks: [Buffer.from("x")],
  });
  check(
    wrongPwUp.status === 403,
    "guest upload with a wrong password: 403",
    JSON.stringify(wrongPwUp.body),
  );
  const foreign = await put(admin, {
    cid,
    path: "/f.txt",
    size: 1,
    chunks: [Buffer.from("x")],
    headers: { origin: "https://evil.example" },
  });
  check(
    foreign.status === 403,
    "upload from a foreign origin is refused",
    JSON.stringify(foreign.body),
  );
  const foreignTicket = await ticket(
    guest,
    { cid, path: "/报告 1.txt", cpw: CHANNEL_PW },
    "https://evil.example",
  );
  check(foreignTicket.status === 403, "download link from a foreign origin is refused");
  const chunked = await put(admin, { cid, path: "/c.txt", chunks: [Buffer.from("x")] });
  check(chunked.status === 411, "upload without Content-Length: 411", JSON.stringify(chunked.body));
  const traversal = await put(admin, {
    cid,
    path: "/../x.txt",
    size: 1,
    chunks: [Buffer.from("x")],
  });
  check(traversal.status === 400, "upload path with ..: 400");
  const tooBig = await put(admin, {
    cid,
    path: "/big.bin",
    size: admin.features.files.maxUploadBytes + 1,
    chunks: [Buffer.from("x")],
  });
  check(
    tooBig.status === 413,
    "upload over the hub limit: 413 before any byte is taken",
    JSON.stringify(tooBig.body),
  );

  /* ---- an empty file ---- */
  const empty = await put(admin, { cid, path: "/empty.txt", cpw: CHANNEL_PW, size: 0, chunks: [] });
  check(empty.status === 201, "an empty file uploads", JSON.stringify(empty.body));
  const emptyTicket = await ticket(guest, { cid, path: "/empty.txt", cpw: CHANNEL_PW });
  const emptyGot = emptyTicket.status === 200 ? await fetchHashed(emptyTicket.body.url) : null;
  check(emptyGot?.res.status === 200 && emptyGot.size === 0, "…and downloads as 0 bytes");

  /* ---- per-session concurrency ---- */
  const parallel = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      put(admin, {
        cid,
        path: `/p${n}.bin`,
        cpw: CHANNEL_PW,
        size: 30 * 1024 * 1024,
        chunks: generated(30 * 1024 * 1024),
      }),
    ),
  );
  const statuses = parallel.map((r) => r.status).sort();
  check(
    statuses.join() === "201,201,201,429" && parallel.some((r) => r.body?.error === "busy"),
    `a fourth simultaneous transfer is refused (limit ${admin.features.files.maxTransfers})`,
    statuses.join(),
  );

  /* ---- a cancelled upload leaves nothing behind ---- */
  const cancelled = await put(admin, {
    cid,
    path: "/cancelled.bin",
    cpw: CHANNEL_PW,
    size: 20 * 1024 * 1024,
    chunks: generated(20 * 1024 * 1024),
    abortAfter: 2 * 1024 * 1024,
  });
  await new Promise((r) => setTimeout(r, 2_500));
  const afterCancel = await list(admin);
  check(
    cancelled.status === 0 && !afterCancel.rows?.some((r) => r.name === "cancelled.bin"),
    "a cancelled upload leaves no partial file",
    JSON.stringify(afterCancel.rows?.map((r) => `${r.name}:${r.size}`)),
  );

  /* ---- a big file, with the hub's memory watched ---- */
  const bigSize = BIG_MB * 1024 * 1024;
  const upHash = createHash("sha256");
  const before = rssMb();
  let stop = sampleRss();
  const t0 = Date.now();
  const bigUp = await put(admin, {
    cid,
    path: "/big.bin",
    cpw: CHANNEL_PW,
    size: bigSize,
    chunks: generated(bigSize, upHash),
  });
  const upSamples = stop();
  check(bigUp.status === 201, `${BIG_MB} MB upload`, `${bigUp.status} in ${Date.now() - t0} ms`);
  const bigTicket = await ticket(guest, { cid, path: "/big.bin", cpw: CHANNEL_PW });
  stop = sampleRss();
  const bigGot = await fetchHashed(bigTicket.body.url);
  const downSamples = stop();
  check(
    bigGot.size === bigSize && bigGot.sha === upHash.digest("hex"),
    `${BIG_MB} MB download has identical bytes`,
  );
  if (HUB_PID) {
    const upPeak = Math.max(...upSamples);
    const downPeak = Math.max(...downSamples);
    check(
      Math.max(upPeak, downPeak) - before < RSS_SLACK_MB,
      "hub memory stays flat while streaming",
      `rss before ${before.toFixed(0)} MB, peak ${upPeak.toFixed(0)} MB up / ${downPeak.toFixed(0)} MB down`,
    );
  }

  /* ---- logs ---- */
  if (HUB_LOG) {
    const log = readFileSync(HUB_LOG, "utf8");
    const ticketId = good.body.url.split("/").pop();
    check(
      !log.includes(ticketId) &&
        !log.includes(CHANNEL_PW) &&
        !log.includes(encodeURIComponent(CHANNEL_PW)) &&
        !/ftkey=(?!\*\*\*)/.test(log),
      "hub log holds no download tickets, transfer keys or channel passwords",
    );
  }
}

run()
  .catch((err) => {
    console.error(err);
    results.push(["FAIL", "run", String(err)]);
  })
  .finally(() => {
    const failed = results.filter(([s]) => s === "FAIL").length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
