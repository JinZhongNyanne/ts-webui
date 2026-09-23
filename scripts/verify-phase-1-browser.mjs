/**
 * Phase 1 verification in a real browser.
 *
 * The resilience items that need a browser rather than a protocol client: that
 * the microphone comes back by itself after a reconnect, that a screen share
 * survives one without asking for the capture again, that the camera is offered
 * rather than silently re-enabled, and that a TeamSpeak-side drop counts its
 * retries before falling back to the banner.
 *
 * Needs the dev server (for the `__jinzRtc` / `__jinzTs` hooks, which only exist
 * in dev builds), a hub, and a TeamSpeak server whose ServerQuery we can reach
 * to kick ourselves off:
 *
 *   npx vite --port 5273                 # apps/web, VITE_HUB_URL pointed at the hub
 *   node scripts/verify-phase-1-browser.mjs --url http://127.0.0.1:5273 \
 *     --ts localhost:9987 --query-pass '<serveradmin password>'
 *
 * `--backend livekit` asserts the hub handed out a LiveKit room, which is how
 * `LiveKitRoom.detachLocalMedia()` gets covered; the default asserts mesh.
 *
 * Chromium runs headed with fake media devices and an auto-selected capture
 * source, so nothing needs a human at the keyboard. Screenshots of each
 * interesting moment land in --shots.
 */
import { chromium } from "playwright";
import { execFile } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const URL_ = argOf("url", "http://127.0.0.1:5273").replace(/\/+$/, "");
const [TS_HOST, TS_PORT = "9987"] = argOf("ts", "localhost:9987").split(":");
const QUERY_PORT = Number(argOf("query-port", "10011"));
const QUERY_USER = argOf("query-user", "serveradmin");
const QUERY_PASS = argOf("query-pass", "");
const BACKEND = argOf("backend", "mesh");
const NICK = argOf("nick", `Web${Math.floor(Math.random() * 900 + 100)}`);
const SHOTS = argOf("shots", "/tmp/jinz-phase1-shots");
/** Container to bounce to produce a real, non-fatal TeamSpeak-side drop. */
const TS_CONTAINER = argOf("ts-container", "");
const HEADED = !args.includes("--headless");

const results = [];
const pass = (name, detail = "") => results.push(["PASS", name, detail]);
const fail = (name, detail = "") => results.push(["FAIL", name, detail]);
const skip = (name, detail = "") => results.push(["SKIP", name, detail]);
const check = (ok, name, detail = "") => (ok ? pass(name, detail) : fail(name, detail));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ ServerQuery (kick) */

/** Minimal ServerQuery client; the one thing we need is to kick ourselves off. */
function query(commands) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: TS_HOST, port: QUERY_PORT });
    const out = [];
    let buf = "";
    let sent = 0;
    let body = "";
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
        // Lines end with "\n\r", so the carriage return leads the next one.
        const line = buf.slice(0, nl).replaceAll("\r", "").trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith("TS3") || line.startsWith("Welcome") || line === "") continue;
        if (line.startsWith("error ")) {
          out.push({ error: line, body });
          body = "";
          if (sent < commands.length) sock.write(commands[sent++] + "\n");
          else {
            clearTimeout(timer);
            sock.end();
            resolve(out);
          }
        } else {
          body = line;
        }
      }
    });
    sock.on("connect", () => setTimeout(() => sock.write(commands[sent++] + "\n"), 300));
  });
}

const qEscape = (s) =>
  String(s).replaceAll("\\", "\\\\").replaceAll("/", "\\/").replaceAll(" ", "\\s");

/** Kicks the client with this nickname off the server (a non-user drop). */
async function kickByNickname(nickname) {
  if (!QUERY_PASS) return false;
  const found = await query([
    `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
    "use sid=1",
    `clientfind pattern=${qEscape(nickname)}`,
  ]);
  const clid = /clid=(\d+)/.exec(found.at(-1)?.body ?? "")?.[1];
  if (!clid) return false;
  await query([
    `login ${qEscape(QUERY_USER)} ${qEscape(QUERY_PASS)}`,
    "use sid=1",
    // reasonid=5 is "kicked from server", which the client reports as a drop
    // it did not ask for — exactly the case the auto-retry is for.
    `clientkick clid=${clid} reasonid=5 reasonmsg=${qEscape("phase1 check")}`,
  ]);
  return true;
}

/* ---------------------------------------------------------------- browser */

const shot = async (page, name) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => undefined);
};

const rtcState = (page) => page.evaluate(() => window.__jinzRtc?.state?.() ?? null);
const bannerText = (page) =>
  page.evaluate(() => document.querySelector(".banner .banner-text")?.textContent?.trim() ?? "");
const micOn = (page) => page.evaluate(() => !!document.querySelector("button.mic.on"));

/** Waits for `fn` to hold, polling; resolves false on timeout rather than throwing. */
async function until(fn, timeoutMs = 30_000, stepMs = 250) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(stepMs);
  }
  return false;
}

async function run() {
  console.log(`ui ${URL_}, teamspeak ${TS_HOST}:${TS_PORT}, expecting ${BACKEND} backend\n`);
  if (!QUERY_PASS) console.log("no --query-pass: the drop-driven checks will skip\n");

  const browser = await chromium.launch({
    headless: !HEADED,
    args: [
      "--use-fake-ui-for-media-stream", // grant camera/mic without a prompt
      "--use-fake-device-for-media-stream", // deterministic fake camera + mic
      "--auto-select-desktop-capture-source=Entire screen", // no screen picker
      "--no-sandbox",
    ],
  });
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message.slice(0, 160)));

  // Count getDisplayMedia calls: the proof that a resumed share reused the
  // capture we already had instead of quietly asking for a new one.
  await page.addInitScript(() => {
    window.__displayMediaCalls = 0;
    const real = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia = (...a) => {
      window.__displayMediaCalls++;
      return real(...a);
    };
  });

  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("form.dialog", { timeout: 20_000 });

  /* -- connect ---------------------------------------------------------- */
  const inputs = page.locator("form.dialog input");
  await inputs.nth(0).fill(TS_HOST);
  await inputs.nth(1).fill(String(TS_PORT));
  await inputs.nth(2).fill(NICK);
  await page.locator("form.dialog button[type=submit]").click();

  const connected = await until(
    async () => (await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) !== null,
    40_000,
  );
  check(connected, "the web client connects to TeamSpeak", `as "${NICK}"`);
  if (!connected) {
    await shot(page, "00-connect-failed");
    await browser.close();
    return report();
  }
  await shot(page, "01-connected");

  /* -- publish a screen share and a camera ------------------------------ */
  await page.evaluate(() => window.__jinzRtc.share());
  const sharing = await until(async () => (await rtcState(page))?.screenOn === true, 30_000);
  check(sharing, "a screen share starts from a real getDisplayMedia capture");

  const backendSeen = (await rtcState(page))?.backend;
  check(
    backendSeen === BACKEND,
    `the room uses the ${BACKEND} backend`,
    `hub handed out "${backendSeen}"`,
  );

  await page.evaluate(() => window.__jinzRtc.camera());
  const camOn = await until(async () => (await rtcState(page))?.cameraOn === true, 20_000);
  check(camOn, "the camera publishes from the fake device");

  const micBefore = await micOn(page);
  const callsBefore = await page.evaluate(() => window.__displayMediaCalls);
  await shot(page, "02-publishing");

  const dropReady = !!TS_CONTAINER;
  if (!dropReady) {
    for (const n of [
      "the banner counts the auto-retry attempts",
      "the session comes back after a TeamSpeak-side drop",
      "the screen share survives the drop",
      "the resumed share reuses the capture (no second getDisplayMedia)",
      "the microphone comes back by itself",
      "the camera is offered rather than re-enabled",
      "clicking the offer turns the camera back on",
    ])
      skip(n, "no --ts-container, cannot drop the TeamSpeak server");
  } else {
    /* -- a real, non-fatal TeamSpeak-side drop --------------------------- */
    // Bouncing the server drops every client without it being the user's doing
    // and without being fatal — exactly what the auto-retry ladder is for.
    const banners = [];
    const watcher = setInterval(async () => {
      const txt = await bannerText(page).catch(() => "");
      if (txt && banners.at(-1) !== txt) banners.push(txt);
    }, 150);

    execFile("docker", ["restart", TS_CONTAINER], () => undefined);

    const dropped = await until(
      async () => (await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) === null,
      45_000,
    );
    check(dropped, "the TeamSpeak server going away drops the session");

    // Give the ladder its 2s/4s/8s, then fall back to the banner's button.
    let back = await until(
      async () => (await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) !== null,
      45_000,
    );
    let clicked = false;
    if (!back) {
      // The budget can run out before a restarting server is listening again;
      // that is the designed fallback, not a failure.
      const btn = page.locator(".banner button.banner-action", { hasText: /reconnect|重新连接/i });
      if (await btn.count()) {
        await shot(page, "03-retry-exhausted");
        await btn.first().click();
        clicked = true;
        back = await until(
          async () => (await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) !== null,
          60_000,
        );
      }
    }
    clearInterval(watcher);
    await shot(page, "04-after-reconnect");

    check(
      banners.some((t) => /\d\s*\/\s*3/.test(t)),
      "the banner counts the auto-retry attempts",
      banners.length ? `saw: ${JSON.stringify(banners.slice(0, 4))}` : "banner never showed",
    );
    check(
      back,
      "the session comes back after a TeamSpeak-side drop",
      clicked ? "after the retry budget ran out and the banner button was clicked" : "on its own",
    );

    if (back) {
      const resumed = await until(async () => (await rtcState(page))?.screenOn === true, 45_000);
      check(resumed, "the screen share survives the drop");

      const callsAfter = await page.evaluate(() => window.__displayMediaCalls);
      check(
        resumed && callsAfter === callsBefore,
        "the resumed share reuses the capture (no second getDisplayMedia)",
        `getDisplayMedia called ${callsBefore}x before, ${callsAfter}x after`,
      );

      if (!micBefore) {
        skip("the microphone comes back by itself", "the mic was not on before the drop");
      } else {
        check(
          await until(async () => await micOn(page), 30_000),
          "the microphone comes back by itself",
        );
      }

      const st = await rtcState(page);
      check(
        st?.cameraOn === false && st?.cameraResumeOffered === true,
        "the camera is offered rather than re-enabled",
        `cameraOn=${st?.cameraOn}, offered=${st?.cameraResumeOffered}`,
      );

      // Tearing the room down races the disconnect, so the browser's rtc.leave /
      // rtc.publishing can land after the session is gone. That must not show
      // up as an error in the user's log.
      const noise = await page.evaluate(() =>
        (window.__jinzTs?.events?.() ?? [])
          .filter((e) => /not_connected/i.test(e.text))
          .map((e) => e.text),
      );
      check(
        noise.length === 0,
        "a reconnect leaves no not_connected errors in the log",
        noise.length ? `saw ${noise.length}: ${JSON.stringify(noise.slice(0, 2))}` : "log is clean",
      );

      const offer = page.locator(".banner button.banner-action", { hasText: /camera|摄像头/i });
      if (await offer.count()) {
        await shot(page, "05-camera-offer");
        await offer.first().click();
        check(
          await until(async () => (await rtcState(page))?.cameraOn === true, 25_000),
          "clicking the offer turns the camera back on",
          "via the real banner button",
        );
        await shot(page, "06-camera-resumed");
      } else {
        fail("clicking the offer turns the camera back on", "no camera button in the banner");
      }
    }
  }

  /* -- a kick is fatal: it must NOT auto-retry --------------------------- */
  if (!QUERY_PASS) {
    skip("a kick does not auto-retry", "no --query-pass, cannot kick the client off");
  } else if ((await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) === null) {
    skip("a kick does not auto-retry", "not connected at this point");
  } else {
    const banners2 = [];
    const watcher2 = setInterval(async () => {
      const txt = await bannerText(page).catch(() => "");
      if (txt && banners2.at(-1) !== txt) banners2.push(txt);
    }, 150);
    const kicked = await kickByNickname(NICK);
    check(kicked, "the server can kick the client off");
    await until(
      async () => (await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) === null,
      20_000,
    );
    // Well past the whole 2s/4s/8s ladder.
    await sleep(20_000);
    clearInterval(watcher2);
    await shot(page, "07-after-kick");
    const stillOff = (await page.evaluate(() => window.__jinzTs?.self?.() ?? null)) === null;
    check(
      stillOff && !banners2.some((t) => /\d\s*\/\s*3/.test(t)),
      "a kick does not auto-retry",
      "an admin kick is fatal; the banner waits for the user instead",
    );
  }

  await browser.close();
  report();
}

function report() {
  console.log();
  for (const [status, name, detail] of results) {
    console.log(`${status}  ${name}${detail ? ` — ${detail}` : ""}`);
  }
  const failed = results.filter((r) => r[0] === "FAIL").length;
  console.log(
    `\n${results.filter((r) => r[0] === "PASS").length} ok, ${failed} failed` +
      `\nscreenshots in ${SHOTS}`,
  );
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
