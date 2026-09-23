/**
 * Phase 3 verification against a real TeamSpeak server.
 *
 * Everything in docs/phase-3-remaining.md that needs a live TS session behind
 * it: the asset token handed out in `hello` (shape, lifetime, rotation and
 * revocation), the routes that now take it instead of the session id, the
 * `x-session-id` header on the fetch-based routes, and the connect log line
 * that shows the hub dialling the address its guard resolved.
 *
 * Run it from the repo root with the hub running:
 *
 *   node scripts/verify-phase-3.mjs                       # hub :8080, ts localhost:9987
 *   node scripts/verify-phase-3.mjs --hub http://127.0.0.1:8080 --ts my.server:9987
 *   node scripts/verify-phase-3.mjs --ts my.server:9987 --password '<server password>'
 *
 * Like the Phase 2 script it uploads a 1x1 PNG only when the identity it
 * connects with has no icon yet, and removes it again afterwards.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const HUB = argOf("hub", "http://127.0.0.1:8080").replace(/\/+$/, "");
const [TS_HOST, TS_PORT = "9987"] = argOf("ts", "localhost:9987").split(":");
const NICK = argOf("nick", "Phase3Check");
const PASSWORD = argOf("password", "");
const ORIGIN = argOf("origin", HUB);

/** What the hub mints: 24 random bytes as base64url. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;
/** The hub's TTL is 15 min; allow for clock skew and the time `hello` took to arrive. */
const TTL_MIN_MS = 10 * 60_000;
const TTL_MAX_MS = 16 * 60_000;
/** How long `registry.remove()` gets to run after the socket closes. */
const REVOKE_SETTLE_MS = 300;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);

const results = [];
const pass = (name, detail = "") => results.push(["PASS", name, detail]);
const fail = (name, detail = "") => results.push(["FAIL", name, detail]);
const skip = (name, detail = "") => results.push(["SKIP", name, detail]);
const check = (ok, name, detail = "") => (ok ? pass(name, detail) : fail(name, detail));

/** Waits for one message of a type, driving the socket that `connect()` opened. */
function ask(state, request, type, timeoutMs = 5_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.ws.off("message", onMessage);
      resolve(null);
    }, timeoutMs);
    function onMessage(data, isBinary) {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type !== type) return;
      clearTimeout(timer);
      state.ws.off("message", onMessage);
      resolve(msg);
    }
    state.ws.on("message", onMessage);
    state.ws.send(JSON.stringify(request));
  });
}

/**
 * One websocket session, resolved once TeamSpeak reports it connected. Keeps
 * the `hello` grant and every `log` line the hub sent on the way in.
 */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}/ws`, { origin: ORIGIN });
    const state = {
      ws,
      sessionId: "",
      grant: null,
      helloAt: 0,
      logs: [],
      uid: "",
      selfClientId: 0,
      server: null,
      clients: [],
    };
    const timer = setTimeout(() => reject(new Error("no `connected` within 30s")), 30_000);
    ws.on("error", reject);
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      const msg = JSON.parse(data.toString());
      if (msg.type === "hello") {
        state.sessionId = msg.sessionId;
        state.grant = msg.assetToken ?? null;
        state.helloAt = Date.now();
        state.features = msg.features;
        ws.send(
          JSON.stringify({
            type: "connect",
            host: TS_HOST,
            port: Number(TS_PORT),
            nickname: NICK,
            ...(PASSWORD ? { serverPassword: PASSWORD } : {}),
          }),
        );
      }
      if (msg.type === "log") state.logs.push(msg);
      if (msg.type === "snapshot") state.clients = msg.clients;
      if (msg.type === "connected") {
        state.uid = msg.uid;
        state.selfClientId = msg.selfClientId;
        state.server = msg.server;
        clearTimeout(timer);
        setTimeout(() => resolve(state), 1_500);
      }
      if (msg.type === "error" && msg.fatal) {
        clearTimeout(timer);
        reject(new Error(`${msg.code}: ${msg.message}`));
      }
    });
  });
}

const get = (path, init) => fetch(`${HUB}${path}`, init);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const minutes = (ms) => `${(ms / 60_000).toFixed(1)} min`;

// 1x1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/** Checks the grant `hello` carried: shape and lifetime. */
function checkGrant(s) {
  const token = s.grant?.token ?? "";
  check(
    TOKEN_SHAPE.test(token),
    "hello carries a 32-char base64url asset token",
    token || "(none)",
  );
  const ahead = Number(s.grant?.expiresAt ?? 0) - s.helloAt;
  check(
    ahead >= TTL_MIN_MS && ahead <= TTL_MAX_MS,
    "the token expires 10–16 min ahead",
    `expiresAt is ${minutes(ahead)} after hello`,
  );
}

/** Checks the connect log line that reports the pinned address. */
function checkDnsPin(s) {
  const line = s.logs.find((l) => l.scope === "connect" && /已解析为/.test(l.message));
  const m = line ? /已解析为 ((?:\d+\.){3}\d+)/.exec(line.message) : null;
  check(
    Boolean(m),
    "connect log names the resolved IPv4 address",
    line?.message ?? "(no such line)",
  );
  if (m && LOOPBACK_HOSTS.has(TS_HOST)) {
    check(m[1] === "127.0.0.1", "a loopback host resolves to 127.0.0.1", m[1]);
  }
}

/** The uid/rev URL of the identity's icon, uploading one if it has none. */
async function ensureIconAsset(s, asSession) {
  const roster = await get("/api/profiles", { headers: asSession });
  const mine = ((await roster.json()).profiles ?? []).find((p) => p.uid === s.uid);
  if (mine?.icon) return { rev: mine.icon, uploaded: false };
  const up = await get("/api/profile/icon", {
    method: "POST",
    headers: { ...asSession, "content-type": "image/png", origin: ORIGIN },
    body: PNG,
  });
  check(up.status === 200, "POST /api/profile/icon via the session header", `HTTP ${up.status}`);
  if (up.status !== 200) return null;
  return { rev: (await up.json()).icon, uploaded: true };
}

async function run() {
  console.log(`hub ${HUB}, teamspeak ${TS_HOST}:${TS_PORT}\n`);
  const s = await connect();
  console.log(`connected as clid ${s.selfClientId}, uid ${s.uid}\n`);
  const session = encodeURIComponent(s.sessionId);
  const token = encodeURIComponent(s.grant?.token ?? "");
  const asSession = { "x-session-id": s.sessionId };

  /* ---- 1. the grant, 2. the pinned address ---------------------------- */

  checkGrant(s);
  checkDnsPin(s);

  /* ---- 6. the fetch-based roster -------------------------------------- */

  const roster = await get("/api/profiles", { headers: asSession });
  check(roster.status === 200, "GET /api/profiles with x-session-id", `HTTP ${roster.status}`);
  const rosterByUrl = await get(`/api/profiles?session=${session}`);
  check(
    rosterByUrl.status === 401,
    "GET /api/profiles with ?session= and no header",
    `HTTP ${rosterByUrl.status}`,
  );

  /* ---- 3. server icon ------------------------------------------------- */

  // Ids below 1000 are the client's own sprites, not files on the server.
  const iconId = Number(s.server?.iconId ?? 0) >>> 0;
  if (iconId >= 1000) {
    const icon = await get(`/api/ts/${token}/icon/${iconId}`);
    const len = icon.status === 200 ? (await icon.arrayBuffer()).byteLength : 0;
    check(
      icon.status === 200 && len > 0,
      `GET the server icon (${iconId}) with the token`,
      `HTTP ${icon.status}, ${len} bytes`,
    );
  } else {
    skip("server icon with the token", "this server has no downloadable icon set");
  }
  const iconBySession = await get(`/api/ts/${session}/icon/${Math.max(iconId, 1000)}`);
  check(
    iconBySession.status === 404,
    "GET /api/ts/<sessionId>/icon/… is 404",
    `HTTP ${iconBySession.status}`,
  );

  /* ---- 4. profile asset, 9. headers ----------------------------------- */

  const asset = await ensureIconAsset(s, asSession);
  const assetUrl = asset
    ? `/api/profile/icon?uid=${encodeURIComponent(s.uid)}&rev=${encodeURIComponent(asset.rev)}`
    : null;
  if (assetUrl) {
    const read = await get(`${assetUrl}&token=${token}`);
    check(read.status === 200, "GET the profile icon with token=", `HTTP ${read.status}`);
    check(
      read.headers.get("x-content-type-options") === "nosniff",
      "the asset carries nosniff",
      read.headers.get("x-content-type-options") ?? "(absent)",
    );
    check(
      read.headers.get("referrer-policy") === "no-referrer",
      "the asset carries Referrer-Policy: no-referrer",
      read.headers.get("referrer-policy") ?? "(absent)",
    );
    const bySession = await get(`${assetUrl}&session=${session}`);
    check(
      bySession.status === 401,
      "GET the profile icon with session= and no token",
      `HTTP ${bySession.status}`,
    );
  }

  /* ---- 5. TTS --------------------------------------------------------- */

  const ttsQuery = "text=hi&voice=en-US-AriaNeural&rate=%2B0%25";
  const tts = await get(`/api/tts/speak?${ttsQuery}&token=${token}`);
  if (tts.status === 502 || tts.status === 504) {
    skip("GET /api/tts/speak with token=", `HTTP ${tts.status}: the hub has no Edge access`);
  } else {
    check(
      tts.status === 200 && (tts.headers.get("content-type") ?? "").includes("audio/mpeg"),
      "GET /api/tts/speak with token=",
      `HTTP ${tts.status} ${tts.headers.get("content-type") ?? ""}`,
    );
  }
  const ttsBySession = await get(`/api/tts/speak?${ttsQuery}&session=${session}`);
  check(
    ttsBySession.status === 401,
    "GET /api/tts/speak with session= and no token",
    `HTTP ${ttsBySession.status}`,
  );

  /* ---- 7. rotation ---------------------------------------------------- */

  // A read that answers 200 with a live token and 401 otherwise. Without an
  // icon to fetch, a missing asset still tells the two apart: 404 is "known
  // token, nothing there" and 401 is "token refused".
  const probeUrl = assetUrl ?? `/api/profile/icon?uid=${encodeURIComponent(s.uid)}&rev=0`;
  const probe = async (t) => (await get(`${probeUrl}&token=${encodeURIComponent(t)}`)).status;
  const authorised = (status) => (assetUrl ? status === 200 : status === 404);

  const fresh = await ask(s, { type: "assetToken.refresh" }, "assetToken");
  const oldToken = s.grant?.token ?? "";
  const newToken = fresh?.token ?? "";
  check(
    TOKEN_SHAPE.test(newToken) && newToken !== oldToken,
    "assetToken.refresh answers with a different token",
    fresh ? newToken : "no reply in 5s",
  );
  const oldStatus = await probe(oldToken);
  check(authorised(oldStatus), "the old token still reads (grace)", `HTTP ${oldStatus}`);
  const newStatus = await probe(newToken);
  check(authorised(newStatus), "the new token reads", `HTTP ${newStatus}`);

  /* ---- clean up before the session goes ------------------------------ */

  if (asset?.uploaded) {
    const del = await get("/api/profile/icon", {
      method: "DELETE",
      headers: { ...asSession, origin: ORIGIN },
    });
    check(del.status === 200, "DELETE the uploaded icon again", `HTTP ${del.status}`);
  }

  /* ---- 8. revocation -------------------------------------------------- */

  s.ws.close();
  await sleep(REVOKE_SETTLE_MS);
  const oldGone = await probe(oldToken);
  const newGone = await probe(newToken);
  check(
    oldGone === 401 && newGone === 401,
    "both tokens are refused once the session ends",
    `HTTP ${oldGone} / ${newGone}`,
  );
  const iconGone = await get(
    `/api/ts/${encodeURIComponent(newToken)}/icon/${Math.max(iconId, 1000)}`,
  );
  check(
    iconGone.status === 404,
    "the icon route refuses a revoked token",
    `HTTP ${iconGone.status}`,
  );
}

run()
  .catch((err) => fail("run", err instanceof Error ? err.message : String(err)))
  .finally(() => {
    console.log(
      results.map(([r, name, detail]) => `${r}  ${name}${detail ? ` — ${detail}` : ""}`).join("\n"),
    );
    const failed = results.filter(([r]) => r === "FAIL").length;
    console.log(`\n${results.length - failed} ok, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  });
