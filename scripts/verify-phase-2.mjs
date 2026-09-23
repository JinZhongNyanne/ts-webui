/**
 * Phase 2 verification against a real TeamSpeak server.
 *
 * Everything in docs/phase-2-remaining.md that needs a live TS session behind
 * it: the session-scoped asset routes, the profile upload rules, the music
 * proxy's path check, and the checks that must still refuse an anonymous or
 * foreign-origin caller while a session exists.
 *
 * Run it from the repo root with the hub running:
 *
 *   node scripts/verify-phase-2.mjs                       # hub :8080, ts localhost:9987
 *   node scripts/verify-phase-2.mjs --hub http://127.0.0.1:8080 --ts my.server:9987
 *   node scripts/verify-phase-2.mjs --ts my.server:9987 --password '<server password>'
 *
 * Since Phase 3 the session id never rides in a URL: `fetch()`-style calls
 * send it in an `x-session-id` header, and the URLs that `<img>`/`<audio>`
 * load carry the short-lived asset token from `hello` instead. The negative
 * checks below present the session id where the token belongs (`?session=`,
 * or in the `/api/ts/` path) and expect it to be refused.
 *
 * It uploads a 1x1 PNG only when the identity it connects with has no icon
 * yet, and removes it again afterwards, so it never overwrites your own.
 */
import WebSocket from "ws";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const HUB = argOf("hub", "http://127.0.0.1:8080").replace(/\/+$/, "");
const [TS_HOST, TS_PORT = "9987"] = argOf("ts", "localhost:9987").split(":");
const NICK = argOf("nick", "Phase2Check");
const PASSWORD = argOf("password", "");
const ORIGIN = argOf("origin", HUB);

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

/** One websocket session, resolved once TeamSpeak reports it connected. */
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HUB.replace(/^http/, "ws")}/ws`, { origin: ORIGIN });
    const state = {
      ws,
      sessionId: "",
      assetToken: "",
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
        state.assetToken = msg.assetToken?.token ?? "";
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
      if (msg.type === "snapshot") state.clients = msg.clients;
      if (msg.type === "client.info") state.info = msg.raw;
      if (msg.type === "connected") {
        state.uid = msg.uid;
        state.selfClientId = msg.selfClientId;
        state.server = msg.server;
        clearTimeout(timer);
        // Give the snapshot a moment to arrive; it carries the avatar hashes.
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

async function run() {
  console.log(`hub ${HUB}, teamspeak ${TS_HOST}:${TS_PORT}\n`);
  const s = await connect();
  console.log(`connected as clid ${s.selfClientId}, uid ${s.uid}\n`);
  const session = encodeURIComponent(s.sessionId);
  const token = encodeURIComponent(s.assetToken);
  // What the page's own fetch() calls send; never a URL.
  const asSession = { "x-session-id": s.sessionId };

  /* ---- the routes that need a live session ---------------------------- */

  const roster = await get("/api/profiles", { headers: asSession });
  check(
    roster.status === 200,
    "GET /api/profiles with the session header",
    `HTTP ${roster.status}`,
  );
  const anonRoster = await get(`/api/profiles?session=${session}`);
  check(
    anonRoster.status === 401,
    "GET /api/profiles with the id in the URL instead",
    `HTTP ${anonRoster.status}`,
  );

  const mine = ((await roster.clone().json()).profiles ?? []).find((p) => p.uid === s.uid);

  if (mine?.icon) {
    skip("profile upload", "this identity already has an icon; not overwriting it");
  } else {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    const up = await get("/api/profile/icon", {
      method: "POST",
      headers: { ...asSession, "content-type": "image/png", origin: ORIGIN },
      body: png,
    });
    check(up.status === 200, "POST /api/profile/icon (own identity)", `HTTP ${up.status}`);
    const rev = up.status === 200 ? (await up.json()).icon : null;

    const foreign = await get("/api/profile/icon", {
      method: "POST",
      headers: { ...asSession, "content-type": "image/png", origin: "https://evil.example.org" },
      body: png,
    });
    check(foreign.status === 403, "POST from a foreign origin", `HTTP ${foreign.status}`);

    const wrongType = await get("/api/profile/icon", {
      method: "POST",
      headers: { ...asSession, "content-type": "application/pdf", origin: ORIGIN },
      body: png,
    });
    check(
      wrongType.status === 415,
      "POST with a type that is not allowed",
      `HTTP ${wrongType.status}`,
    );

    if (rev) {
      const url = `/api/profile/icon?uid=${encodeURIComponent(s.uid)}&rev=${rev}`;
      const read = await get(`${url}&token=${token}`);
      const bytes = read.status === 200 ? (await read.arrayBuffer()).byteLength : 0;
      check(
        read.status === 200 && bytes === png.length,
        "GET the uploaded icon back",
        `HTTP ${read.status}, ${bytes} bytes`,
      );
      check(
        read.headers.get("x-content-type-options") === "nosniff",
        "uploaded asset carries nosniff",
        read.headers.get("x-content-type-options") ?? "(absent)",
      );
      const anon = await get(`${url}&session=${session}`);
      check(
        anon.status === 401,
        "GET the icon with the id instead of a token",
        `HTTP ${anon.status}`,
      );
    }

    const del = await get("/api/profile/icon", {
      method: "DELETE",
      headers: { ...asSession, origin: ORIGIN },
    });
    check(del.status === 200, "DELETE the icon again", `HTTP ${del.status}`);
  }

  /* ---- TeamSpeak icons and avatars ------------------------------------ */

  // Ids below 1000 are the client's own sprites, not files on the server.
  const iconId = Number(s.server?.iconId ?? 0) >>> 0;
  if (iconId >= 1000) {
    const icon = await get(`/api/ts/${token}/icon/${iconId}`);
    const len = icon.status === 200 ? (await icon.arrayBuffer()).byteLength : 0;
    check(
      icon.status === 200 && len > 0,
      `GET the server icon (${iconId})`,
      `HTTP ${icon.status}, ${len} bytes`,
    );
    const anonIcon = await get(`/api/ts/${session}/icon/${iconId}`);
    check(
      anonIcon.status === 404,
      "GET an icon with the session id in place of the token",
      `HTTP ${anonIcon.status}`,
    );
  } else {
    skip("server icon", "this server has no downloadable icon set");
  }

  const info = await ask(s, { type: "getClientInfo", clientId: s.selfClientId }, "client.info");
  check(
    Boolean(info?.raw ?? info),
    "getClientInfo over the websocket",
    info ? "" : "no reply in 5s",
  );
  const avatar = (info?.raw ?? {}).client_flag_avatar;
  if (avatar) {
    const res = await get(`/api/ts/${token}/avatar/${encodeURIComponent(avatar)}`);
    const len = res.status === 200 ? (await res.arrayBuffer()).byteLength : 0;
    check(res.status === 200 && len > 0, "GET a client avatar", `HTTP ${res.status}, ${len} bytes`);
  } else {
    skip("client avatar", "this client has no avatar");
  }

  /* ---- TTS ------------------------------------------------------------ */

  const tts = await get(`/api/tts/speak?token=${token}&text=${encodeURIComponent("测试")}`);
  if (tts.status === 502 || tts.status === 504) {
    skip("GET /api/tts/speak with a token", `HTTP ${tts.status}: the hub cannot reach Edge TTS`);
  } else {
    check(
      tts.status === 200 && (tts.headers.get("content-type") ?? "").includes("audio/mpeg"),
      "GET /api/tts/speak with a token",
      `HTTP ${tts.status} ${tts.headers.get("content-type") ?? ""}`,
    );
  }
  const anonTts = await get(`/api/tts/speak?text=hi&session=${session}`);
  check(
    anonTts.status === 401,
    "GET /api/tts/speak with the id instead of a token",
    `HTTP ${anonTts.status}`,
  );

  /* ---- music proxy ---------------------------------------------------- */

  if (s.features?.music) {
    const headers = { ...asSession, origin: ORIGIN };
    const bots = await get("/api/music-bot/bot", { headers });
    if (bots.status === 502) {
      // The hub answers this itself when the bot behind the TeamSpeak host
      // does not exist; the path checks below never reach that far.
      skip("GET /api/music-bot/bot (whitelisted)", "HTTP 502: no music bot at the TeamSpeak host");
    } else {
      check(bots.status < 400, "GET /api/music-bot/bot (whitelisted)", `HTTP ${bots.status}`);
    }
    const traversal = await get("/api/music-bot/player/../fm", { method: "POST", headers });
    check(
      traversal.status === 403,
      "POST /api/music-bot/player/../fm is refused",
      `HTTP ${traversal.status}`,
    );
    const management = await get("/api/music-bot/users", { headers });
    check(
      management.status === 403,
      "GET /api/music-bot/users is refused",
      `HTTP ${management.status}`,
    );
  } else {
    skip("music proxy", "this hub does not offer the music panel");
  }

  /* ---- headers -------------------------------------------------------- */

  const health = await get("/api/health");
  check(health.headers.get("referrer-policy") === "no-referrer", "Referrer-Policy on API replies");
  check(
    (health.headers.get("content-security-policy") ?? "").includes("default-src 'none'"),
    "CSP on API replies",
  );

  s.ws.close();
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
