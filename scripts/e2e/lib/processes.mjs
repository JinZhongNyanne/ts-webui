/**
 * Starting (and reliably stopping) the hub and vite for a test run.
 *
 * Each child is spawned `detached`, which makes it the leader of its own
 * process group: tsx and vite both fork helpers, and killing the group is the
 * only way to take those down too without hunting by name — the rig must
 * never touch processes it did not start (other checkouts run their own).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, createWriteStream } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** True when something already listens on host:port. */
export function portInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
  });
}

/** Polls `url` until it answers 2xx, or throws after `timeoutMs`. */
export async function waitForHttp(url, timeoutMs = 60_000, child = null) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`${child.label} exited with code ${child.exitCode} before ${url} came up`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.cause?.code ?? err.message;
    }
    await sleep(300);
  }
  throw new Error(`${url} did not come up within ${timeoutMs / 1000}s (${last})`);
}

/**
 * Spawns `cmd args` in its own process group, logging to `logFile`. The
 * returned child carries `label` and `logFile` for error messages.
 */
function start(label, cmd, args, { cwd, env, logFile }) {
  const log = createWriteStream(logFile);
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.label = label;
  child.logFile = logFile;
  return child;
}

/** SIGTERM to the whole group, then SIGKILL if it lingers. */
export async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const group = -child.pid;
  const exited = new Promise((r) => child.once("exit", r));
  try {
    process.kill(group, "SIGTERM");
  } catch {
    return; // already gone
  }
  const done = await Promise.race([exited.then(() => true), sleep(5_000).then(() => false)]);
  if (!done) {
    try {
      process.kill(group, "SIGKILL");
    } catch {
      /* gone between the check and the kill */
    }
  }
}

/** The hub imports @jinz/protocol from its build output. */
export function ensureProtocolBuilt(root) {
  if (existsSync(path.join(root, "packages/protocol/dist/index.js"))) return;
  console.log("building packages/protocol (first run)…");
  const res = spawnSync("npm", ["run", "build", "-w", "packages/protocol"], {
    cwd: root,
    stdio: "inherit",
  });
  if (res.status !== 0) throw new Error("building packages/protocol failed");
}

/**
 * Starts a hub for the test: no gateway password, no fixed server, private
 * TeamSpeak addresses allowed, and limits raised so several browser clients
 * from one IP (all of ours are 127.0.0.1) never hit them.
 */
export async function startHub({ root, port, webOrigin, logDir }) {
  if (await portInUse(port)) {
    throw new Error(
      `port ${port} is already in use — pass --hub-url to reuse that hub, or --hub-port to pick another`,
    );
  }
  ensureProtocolBuilt(root);
  const dataDir = mkdtempSync(path.join(os.tmpdir(), "jinz-e2e-hub-"));
  const tsx = path.join(root, "node_modules/tsx/dist/cli.mjs");
  const child = start("hub", process.execPath, [tsx, "apps/hub/src/index.ts"], {
    cwd: root,
    logFile: path.join(logDir, "hub.log"),
    env: {
      NODE_ENV: "development",
      HUB_HOST: "127.0.0.1",
      HUB_PORT: String(port),
      HUB_PUBLIC_ORIGIN: webOrigin,
      HUB_ALLOWED_ORIGINS: webOrigin.replace("127.0.0.1", "localhost"),
      // Set explicitly so a developer's .env cannot turn them on for the test.
      HUB_PASSWORD: "",
      HUB_TS_SERVER: "",
      HUB_TS_PASSWORD: "",
      HUB_ALLOWED_TS_SERVERS: "",
      HUB_ALLOW_PRIVATE_TS_SERVERS: "1",
      HUB_TRUST_PROXY: "0",
      HUB_MAX_SESSIONS_PER_IP: "50",
      HUB_CONNECT_RATE_PER_MIN: "200",
      HUB_HTTP_RATE_PER_MIN: "5000",
      HUB_COMMAND_RATE_PER_MIN: "5000",
      HUB_DATA_DIR: dataDir,
      HUB_LOG_LEVEL: process.env.HUB_LOG_LEVEL ?? "info",
      HUB_LOG_PRETTY: "0",
      // No LiveKit: web-to-web video falls back to mesh, which needs nothing.
      LIVEKIT_URL: "",
      LIVEKIT_API_KEY: "",
      LIVEKIT_API_SECRET: "",
    },
  });
  child.cleanupDir = dataDir;
  await waitForHttp(`http://127.0.0.1:${port}/api/health`, 60_000, child);
  return child;
}

/** Starts vite for apps/web, proxying /api and /ws to `hubUrl`. */
export async function startWeb({ root, port, hubUrl, logDir }) {
  if (await portInUse(port)) {
    throw new Error(
      `port ${port} is already in use — pass --web-url to reuse that server, or --web-port to pick another`,
    );
  }
  ensureProtocolBuilt(root);
  const vite = path.join(root, "node_modules/vite/bin/vite.js");
  const child = start(
    "vite",
    process.execPath,
    [vite, "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    {
      cwd: path.join(root, "apps/web"),
      logFile: path.join(logDir, "vite.log"),
      env: { VITE_HUB_URL: hubUrl },
    },
  );
  await waitForHttp(`http://127.0.0.1:${port}/`, 90_000, child);
  return child;
}

/** Stops a child started here and removes its scratch data. */
export async function stopAndClean(child) {
  await stop(child);
  if (child?.cleanupDir) rmSync(child.cleanupDir, { recursive: true, force: true });
}
