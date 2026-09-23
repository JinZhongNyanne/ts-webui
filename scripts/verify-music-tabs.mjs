/**
 * Browser check for the music panel's browse tabs (发现 / 音乐库 / 播放历史).
 *
 * Needs a hub, a TeamSpeak server to connect to, and a reachable music bot —
 * the bot does not have to live on that TeamSpeak host, since every session
 * picks its own bot address in the connect dialog:
 *
 *   URL=http://127.0.0.1:5274 TS_HOST=127.0.0.1 BOT=https://bot.example:8443 \
 *     node scripts/verify-music-tabs.mjs
 *
 * The assertions about which sections appear assume the hub holds a GUEST
 * session with the bot: the daily picks, the bot's own playlists and its
 * starred playlists all need a non-guest session, so those sections are
 * expected to hide themselves.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const URL_ = process.env.URL ?? "http://127.0.0.1:5274";
const TS_HOST = process.env.TS_HOST ?? "127.0.0.1";
const TS_PASS = process.env.TS_PASS ?? "";
const BOT = process.env.BOT ?? "";
const NICK = `TabCheck${Math.floor(Math.random() * 900 + 100)}`;
const SHOTS = process.env.SHOTS ?? "/tmp/jinz-music-tabs-shots";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (ok, name, detail = "") => results.push([ok ? "PASS" : "FAIL", name, detail]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (p, n) => p.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: false });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

const inputs = page.locator(".dialog input, dialog input, form input");
await inputs.nth(0).fill(TS_HOST);
await inputs.nth(2).fill(NICK);
await inputs.nth(3).fill(TS_PASS);
await inputs.nth(5).fill(BOT);
await page.locator('button[type="submit"]').first().click();

// Wait for the panel to show a bot.
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  await sleep(1000);
  ready = (await page.locator("nav.tabs button", { hasText: /发现|Discover/ }).count()) > 0;
}
check(ready, "the music panel shows its tabs", ready ? "" : "no tab bar after 60s");
await shot(page, "00-connected");
if (!ready) {
  console.log(
    await page
      .locator("section.music")
      .innerText()
      .catch(() => "no panel"),
  );
  await browser.close();
  process.exit(1);
}

const panel = page.locator("section.music");
const tab = (re) => panel.locator("nav.tabs button", { hasText: re }).first();
const body = () => panel.locator(".list");

/* ------------------------------------------------------------- 发现 */
await tab(/发现|Discover/).click();
await sleep(6000);
await shot(page, "01-discover");
const discoverText = await body().innerText();
check(/推荐歌单|RECOMMENDED/i.test(discoverText), "discover lists recommended playlists");
const cards = await body().locator(".card").count();
check(cards > 0, "discover rendered playlist cards", `${cards} cards`);
check(
  /私人FM|PERSONAL RADIO/i.test(discoverText),
  "discover offers the personal radio the guest may start",
);
check(
  !/每日推荐|DAILY PICKS/i.test(discoverText),
  "the daily picks section hides itself (bot answers 403 to a guest)",
);
check(
  /B站热门|POPULAR ON BILIBILI/i.test(discoverText),
  "discover lists Bilibili's popular videos",
);

/* ---------------------------------------------------- playlist drill-in */
await body().locator(".card").first().click();
await sleep(6000);
await shot(page, "02-playlist");
const plText = await body().innerText();
const songRows = await body().locator(".item").count();
check(songRows > 0, "opening a playlist card lists its songs", `${songRows} rows`);
check(/返回|Back/.test(plText), "the playlist view offers a way back");
await body()
  .locator("button", { hasText: /返回|Back/ })
  .first()
  .click();
await sleep(1000);
check((await body().locator(".card").count()) > 0, "back returns to the playlist grid");

/* ------------------------------------------------------------ 音乐库 */
await tab(/音乐库|Library/).click();
await sleep(6000);
await shot(page, "03-library");
const libText = await body().innerText();
check(/最近播放|RECENTLY PLAYED/i.test(libText), "library shows the recently-played section");
check(
  !/我的歌单|BOT'S PLAYLISTS/i.test(libText) && !/我的收藏|STARRED/i.test(libText),
  "library hides the sections a guest session may not read",
);

/* ---------------------------------------------------------- 播放历史 */
await tab(/播放历史|History/).click();
await sleep(5000);
await shot(page, "04-history");
const histRows = await body().locator(".item").count();
check(histRows > 0, "history lists what the bot played", `${histRows} rows`);
const first = body().locator(".item").first();
// A history row must offer "add" but neither play-now nor play-next: the bot
// cannot resolve a stream from a stored record.
const btns = (await first.locator("button.mini").allTextContents()).map((s) => s.trim());
check(
  btns.includes("＋") && !btns.includes("▶") && !btns.includes("⤴"),
  "a history row only offers re-queueing, not instant play",
  btns.join(" "),
);

/* ------------------------------------------------------------- 队列 */
await tab(/队列|Queue/).click();
await sleep(1000);
check((await body().innerText()).length > 0, "the queue tab still renders");
await shot(page, "05-queue");

const unexpected = errors.filter((e) => !/403 \(Forbidden\)/.test(e));
check(unexpected.length === 0, "no unexpected console errors", unexpected.slice(0, 3).join(" | "));
check(
  errors.filter((e) => /403/.test(e)).length === 3,
  "exactly the three guest-only routes answered 403",
  `${errors.filter((e) => /403/.test(e)).length} of them`,
);

for (const [s, n, d] of results) console.log(`${s}  ${n}${d ? `  — ${d}` : ""}`);
console.log(results.some(([s]) => s === "FAIL") ? "\nFAILED" : "\nALL PASS");
await browser.close();
process.exit(results.some(([s]) => s === "FAIL") ? 1 : 0);
