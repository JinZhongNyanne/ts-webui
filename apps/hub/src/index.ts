import path from "node:path";
import { existsSync } from "node:fs";
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import { loadConfig, publicIceServers } from "./config.js";
import { registerSecurityHeaders } from "./security/headers.js";
import { registerEmptyBodyParser } from "./http/empty-body.js";
import { isOriginAllowed } from "./security/origin.js";
import { ConcurrencyLimiter, RateLimiter } from "./security/limits.js";
import { createLogger } from "./logger.js";
import { Session } from "./session/Session.js";
import { SessionRegistry } from "./session/registry.js";
import { AssetTokenStore } from "./session/asset-token.js";
import { BridgePool } from "./musicbot/BridgePool.js";
import { MusicStateStore } from "./musicbot/music-state.js";
import { registerMusicRoutes } from "./musicbot/routes.js";
import { registerCoverRoutes } from "./musicbot/cover-routes.js";
import { LiveKitService } from "./rtc/livekit.js";
import { RoomRegistry } from "./rooms/RoomRegistry.js";
import { configureAssetCache } from "./gateway/asset-cache.js";
import { registerIconRoutes } from "./gateway/icon-routes.js";
import { registerTtsRoutes } from "./tts/routes.js";
import { ProfileStore } from "./profiles/store.js";
import { registerProfileRoutes } from "./profiles/routes.js";
import { AppStore } from "./webapps/store.js";
import { registerAppRoutes } from "./webapps/routes.js";
import { fetchSiteIcon } from "./webapps/icon.js";
import { SoundStore } from "./sounds/store.js";
import { registerSoundRoutes } from "./sounds/routes.js";
import { StickerStore } from "./stickers/store.js";
import { registerStickerRoutes } from "./stickers/routes.js";
import { registerFileRoutes } from "./files/routes.js";
import { hasHubPass, registerHubAuth } from "./http/auth-routes.js";
import { registerWebUi } from "./http/web-ui.js";
import { HubAuth, WS_CLOSE_UNAUTHORIZED } from "./security/hub-auth.js";
import type { HubModule } from "./modules.js";

/** Where a reverse proxy in front of the hub can live (proxy-addr range names). */
const TRUSTED_PROXY_RANGES = "loopback,linklocal,uniquelocal";

/** Soundboard uploads, renames, volume changes and deletes one session may make per minute. */
const SOUND_WRITES_PER_MIN = 30;

/** Sticker uploads, edits, deletes and pack changes one session may make per minute. */
const STICKER_WRITES_PER_MIN = 40;

/** Wrong hub passwords one address may try per minute. */
const LOGIN_ATTEMPTS_PER_MIN = 10;

/** Loads a .env from the repo root or cwd when present (production uses real env vars). */
function loadDotEnv(): void {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(import.meta.dirname, "../../../.env"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      /* ignore malformed .env */
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const logger = createLogger(config);
  const registry = new SessionRegistry(new AssetTokenStore(), (err) =>
    logger.error({ err }, "session end listener failed"),
  );
  const rtc = config.rtcBackend === "livekit" ? new LiveKitService(config) : undefined;
  /** Extension modules (Emby sync etc.) get registered here. */
  const modules: HubModule[] = [];
  const rooms = new RoomRegistry(modules);

  // Each session names its bot on connect; the pool shares one bridge per bot
  // URL between the sessions using it. MUSICBOT_URL is only the default.
  const musicLog = logger.child({ mod: "musicbot" });
  const music = new BridgePool({
    config,
    logger: musicLog,
    state: new MusicStateStore(path.resolve(config.HUB_DATA_DIR, "music-state.json"), musicLog),
  });

  // Trusting `X-Forwarded-For` from anyone would let a client pick its own IP,
  // which is what the per-IP limits below key on. Only turn it on behind a
  // proxy the operator controls (the bundled Caddy).
  //
  // Trusting a proxy means trusting the proxy's own address, not `true`: with
  // `true` Fastify takes the leftmost X-Forwarded-For entry, which the client
  // writes itself (proxies append), and a login could pick a fresh IP per
  // guess. A reverse proxy in front of this hub sits on loopback or a private
  // network (docker bridge, LAN), so hops from there are believed and the
  // first public address from the right is the client. (A hop count would not
  // do: Fastify treats a number as "trust nothing".)
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: config.HUB_TRUST_PROXY ? TRUSTED_PROXY_RANGES : false,
  });
  await app.register(fastifyWebsocket, {
    options: { maxPayload: 64 * 1024 },
  });
  registerSecurityHeaders(app, { isProd: config.isProd });
  registerEmptyBodyParser(app);

  const originPolicy = { allowed: config.allowedOrigins, allowLoopback: !config.isProd };
  const httpLimiter = new RateLimiter({ limit: config.HUB_HTTP_RATE_PER_MIN, windowMs: 60_000 });
  const sessionsPerIp = new ConcurrencyLimiter(config.HUB_MAX_SESSIONS_PER_IP);

  app.addHook("onRequest", async (request, reply) => {
    // The matched route, not the raw URL, which `/%61pi/...` would slip past.
    if (!request.routeOptions.url?.startsWith("/api/")) return;
    // A write from a foreign page is a session id someone else has learned;
    // reads stay open to the `<img>`/`<audio>` tags that carry no origin.
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (!isOriginAllowed(request.headers.origin, originPolicy)) {
        logger.warn({ origin: request.headers.origin }, "rejecting api call from foreign origin");
        return reply.code(403).send({ error: "forbidden origin" });
      }
    }
    if (!httpLimiter.take(request.ip)) {
      return reply.code(429).send({ error: "too many requests" });
    }
  });

  // Registered after the origin/rate hook above, so a login is a checked write.
  const auth = new HubAuth({ password: config.HUB_PASSWORD, secret: config.HUB_SESSION_SECRET });
  await registerHubAuth(app, {
    auth,
    loginLimiter: new RateLimiter({ limit: LOGIN_ATTEMPTS_PER_MIN, windowMs: 60_000 }),
    logger: logger.child({ mod: "auth" }),
  });

  registerMusicRoutes(app, {
    registry,
    logger,
    limiter: new RateLimiter({ limit: config.HUB_MUSIC_RATE_PER_MIN, windowMs: 60_000 }),
  });
  registerCoverRoutes(app, {
    registry,
    logger: logger.child({ mod: "cover" }),
    limiter: new RateLimiter({ limit: config.HUB_MUSIC_RATE_PER_MIN, windowMs: 60_000 }),
  });
  configureAssetCache({ maxBytes: config.HUB_ASSET_CACHE_MAX_BYTES });
  registerIconRoutes(app, registry);
  const profiles = new ProfileStore(path.resolve(config.HUB_DATA_DIR, "profiles"), logger);
  profiles.sweep();
  registerProfileRoutes(app, { store: profiles, registry: registry });
  registerAppRoutes(app, {
    store: new AppStore(path.resolve(config.HUB_DATA_DIR, "apps"), logger),
    registry,
    logger: logger.child({ mod: "apps" }),
    ownOrigins: config.allowedOrigins,
    limiter: new RateLimiter({ limit: 20, windowMs: 60_000 }),
    fetchIcon: (site) => fetchSiteIcon(site),
  });
  registerSoundRoutes(app, {
    store: new SoundStore(path.resolve(config.HUB_DATA_DIR, "sounds"), logger),
    registry,
    limiter: new RateLimiter({ limit: SOUND_WRITES_PER_MIN, windowMs: 60_000 }),
  });
  const stickers = new StickerStore(path.resolve(config.HUB_DATA_DIR, "stickers"), logger);
  stickers.sweep();
  registerStickerRoutes(app, {
    store: stickers,
    registry,
    limiter: new RateLimiter({ limit: STICKER_WRITES_PER_MIN, windowMs: 60_000 }),
  });
  await registerFileRoutes(app, {
    registry,
    limits: {
      maxUploadBytes: config.HUB_FT_MAX_UPLOAD_BYTES,
      maxTransfers: config.HUB_FT_MAX_TRANSFERS_PER_SESSION,
    },
    limiter: new RateLimiter({ limit: config.HUB_FT_RATE_PER_MIN, windowMs: 60_000 }),
    media: {
      limiter: new RateLimiter({ limit: config.HUB_FT_MEDIA_OPENS_PER_MIN, windowMs: 60_000 }),
    },
    maxHubTransfers: config.HUB_FT_MAX_TRANSFERS,
    stall: {
      windowMs: config.HUB_FT_STALL_SECONDS * 1000,
      minBytes: config.HUB_FT_STALL_MIN_BYTES,
    },
    logger: logger.child({ mod: "files" }),
  });
  registerTtsRoutes(app, {
    registry: registry,
    logger: logger.child({ mod: "tts" }),
    limiter: new RateLimiter({ limit: config.HUB_TTS_RATE_PER_MIN, windowMs: 60_000 }),
  });
  for (const mod of modules) mod.registerRoutes?.(app);

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/config", async () => ({
    // A fixed server's address stays on the hub; the page only needs to know
    // it should not ask for one.
    fixedServer: config.fixedServer !== null,
    defaultServer: config.fixedServer ? "" : config.HUB_DEFAULT_TS_SERVER,
    // Only a public name (or HUB_TS_PUBLIC_ADDRESS), for links native clients open.
    publicServer: config.fixedServer ? config.publicServer : null,
    features: {
      video: config.videoEnabled,
      music: true,
      rtc: config.rtcBackend,
      // TURN credentials belong to a connected session, not to every visitor.
      iceServers: publicIceServers(config.iceServers),
    },
  }));

  app.get("/ws", { websocket: true }, (socket, request) => {
    if (!isOriginAllowed(request.headers.origin, originPolicy)) {
      logger.warn({ origin: request.headers.origin }, "rejecting websocket from foreign origin");
      socket.close(4403, "forbidden origin");
      return;
    }
    if (!hasHubPass(auth, request)) {
      socket.close(WS_CLOSE_UNAUTHORIZED, "hub password required");
      return;
    }
    // One browser opens one session; a script opening thousands would hold a
    // TeamSpeak client (and an identity slot) for each of them.
    const ip = request.ip;
    if (!sessionsPerIp.acquire(ip)) {
      logger.warn({ ip, open: sessionsPerIp.count(ip) }, "too many sessions from one address");
      socket.close(4429, "too many sessions");
      return;
    }
    socket.once("close", () => sessionsPerIp.release(ip));
    new Session(socket, { config, logger, registry, music, rtc, rooms });
  });

  const staticDir = resolveStaticDir(config.HUB_STATIC_DIR);
  if (staticDir) {
    await registerWebUi(app, staticDir);
    logger.info({ staticDir }, "serving web ui");
  }

  await app.listen({ host: config.HUB_HOST, port: config.HUB_PORT });
  logger.info(
    {
      build: config.BUILD_ID || "(unknown)",
      video: config.videoEnabled,
      rtc: config.rtcBackend,
      music: true,
      musicDefault: config.MUSICBOT_URL || "(teamspeak host)",
      hubPassword: auth.required,
      fixedServer: config.fixedServer
        ? `${config.fixedServer.host}:${config.fixedServer.port}`
        : null,
    },
    `hub listening on http://${config.HUB_HOST}:${config.HUB_PORT}`,
  );

  const shutdown = async () => {
    logger.info("shutting down");
    music.stopAll();
    // Leave TeamSpeak cleanly first: a client that just vanishes lingers on the
    // server as a ghost and blocks the next connect with the same identity.
    const goodbye = [...registry.values()].map((s) => s.shutdown().catch(() => undefined));
    await Promise.race([Promise.all(goodbye), new Promise((r) => setTimeout(r, 2_000))]);
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  // One browser session must not be able to kill the hub for everyone else.
  // The TeamSpeak driver throws from inside its own socket callbacks, where no
  // caller can catch it; staying up with a loud log beats dropping every other
  // session. A crash loop still shows up as repeated fatal lines.
  process.on("uncaughtException", (err, origin) => {
    logger.fatal({ err, origin }, "uncaught exception; keeping the hub alive");
  });
  process.on("unhandledRejection", (reason) => {
    logger.fatal({ err: reason }, "unhandled rejection; keeping the hub alive");
  });
}

function resolveStaticDir(configured: string): string | null {
  if (configured) return path.resolve(configured);
  // Production default: the web build sits next to the hub build.
  const guess = path.resolve(import.meta.dirname, "../../web/dist");
  return process.env.NODE_ENV === "production" && existsSync(guess) ? guess : null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
