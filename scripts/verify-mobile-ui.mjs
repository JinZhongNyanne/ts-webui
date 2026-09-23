/**
 * Browser check for the mobile shell.
 *
 * Renders the app at phone size against a real TeamSpeak server and walks the
 * tabs, the conversation chips, the voice bar, the settings panel and the
 * long-press context menu — the parts that only exist below the breakpoint and
 * so cannot be covered by the unit tests.
 *
 *   URL=http://127.0.0.1:5284 TS_HOST=ts.example.com TS_PASS=<server password> \
 *     BOT=https://bot.example.com:8443 node scripts/verify-mobile-ui.mjs
 */
import { chromium, devices } from "playwright";
import fs from "node:fs";

const URL_ = process.env.URL ?? "http://127.0.0.1:5284";
const TS_HOST = process.env.TS_HOST ?? "127.0.0.1";
const TS_PASS = process.env.TS_PASS ?? "";
const BOT = process.env.BOT ?? "";
const NICK = `Mobile${Math.floor(Math.random() * 900 + 100)}`;
const SHOTS = process.env.SHOTS ?? "/tmp/jinz-mobile-shots";
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (ok, name, detail = "") => results.push([ok ? "PASS" : "FAIL", name, detail]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
// A real phone profile: touch events, device pixel ratio, mobile user agent.
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(URL_, { waitUntil: "domcontentloaded" });
await sleep(1200);

/* ------------------------------------------------- the connect dialog */
await shot(page, "00-connect");
const dialog = page.locator("form.dialog");
check(await dialog.isVisible(), "the connect dialog renders on a phone");
const dlgBox = await dialog.boundingBox();
const vp = page.viewportSize();
check(
  dlgBox && dlgBox.width <= vp.width && dlgBox.x >= 0,
  "the dialog fits the viewport width",
  dlgBox ? `${Math.round(dlgBox.width)}px of ${vp.width}px` : "no box",
);
check(
  (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) === true,
  "the connect screen does not scroll sideways",
);

const inputs = page.locator("form.dialog input");
await inputs.nth(0).fill(TS_HOST);
await inputs.nth(2).fill(NICK);
await inputs.nth(3).fill(TS_PASS);
if (BOT) await inputs.nth(5).fill(BOT);
await page.locator('button[type="submit"]').first().click();

let connected = false;
for (let i = 0; i < 45 && !connected; i++) {
  await sleep(1000);
  connected = (await page.locator(".mshell").count()) > 0;
}
check(connected, "the mobile shell replaces the dock once connected");
if (!connected) {
  console.log(results.map((r) => r.join(" | ")).join("\n"));
  await browser.close();
  process.exit(1);
}
await sleep(2500);
await shot(page, "01-tree");

/* ------------------------------------------------------- the dock is gone */
check(
  (await page.locator(".dockview-theme-abyss").count()) === 0,
  "dockview is never mounted on a phone",
);
check((await page.locator("footer.bar").count()) === 0, "the desktop status bar is hidden");

/* ----------------------------------------------------------- the chrome */
const tabbar = page.locator("nav.tabbar");
check(await tabbar.isVisible(), "the tab bar is visible");
const tabCount = await tabbar.locator("button.tab").count();
check(tabCount >= 2, "the tab bar offers at least channels and chat", `${tabCount} tabs`);
check(await page.locator(".voicebar button.mic").isVisible(), "the voice bar is always on screen");

// Every control the thumb must hit is at least 40px tall.
const small = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll(
    "nav.tabbar button, .voicebar button, header.top button",
  )) {
    const r = el.getBoundingClientRect();
    if (r.height < 40) bad.push(`${el.className || el.tagName}:${Math.round(r.height)}px`);
  }
  return bad;
});
check(small.length === 0, "the chrome's touch targets are at least 40px tall", small.join(", "));

check(
  (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) === true,
  "the shell does not scroll sideways",
);

/* ------------------------------------------------------------- the tabs */
const tabByName = (re) => tabbar.locator("button.tab", { hasText: re }).first();
const names = await tabbar.locator("button.tab .label").allInnerTexts();

await tabByName(/聊天|Chat/).click();
await sleep(600);
await shot(page, "02-chat");
const chips = await page.locator(".chatview .chip").count();
check(chips >= 1, "the chat view lists its conversations as chips", `${chips} chips`);
check(
  await page.locator(".chatview .chip.active").isVisible(),
  "one conversation chip is marked active",
);

if (names.some((n) => /视频|Video/.test(n))) {
  await tabByName(/视频|Video/).click();
  await sleep(600);
  await shot(page, "03-video");
  check(await page.locator("section.video").isVisible(), "the video tab renders");
}

if (names.some((n) => /点歌|Music/.test(n))) {
  await tabByName(/点歌|Music/).click();
  await sleep(3000);
  await shot(page, "04-music");
  check(await page.locator("section.music").isVisible(), "the music tab renders the panel");
}

/* --------------------------------------------- long press -> context menu */
await tabByName(/频道|Channels/).click();
await sleep(600);
const row = page.locator(".tree .channel").first();
const box = await row.boundingBox();
check(!!box, "the channel tree has rows to press");
if (box) {
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // A held finger, not a tap: touchstart, wait past the threshold, touchend.
  await page.touchscreen.tap(x, y); // select first, as a user would
  await sleep(300);
  await page.evaluate(
    ([sx, sy]) => {
      const el = document.elementFromPoint(sx, sy);
      const touch = new Touch({ identifier: 1, target: el, clientX: sx, clientY: sy });
      el.dispatchEvent(
        new TouchEvent("touchstart", { touches: [touch], bubbles: true, cancelable: true }),
      );
    },
    [x, y],
  );
  await sleep(900);
  const menuOpen = await page
    .locator(".cm-overlay.mobile")
    .isVisible()
    .catch(() => false);
  check(menuOpen, "a long press opens the context menu as a bottom sheet");
  if (menuOpen) {
    await shot(page, "05-longpress-menu");
    const itemHeights = await page.evaluate(() =>
      [...document.querySelectorAll(".cm-overlay.mobile .cm-item")].map((el) =>
        Math.round(el.getBoundingClientRect().height),
      ),
    );
    check(
      itemHeights.length > 0 && itemHeights.every((h) => h >= 44),
      "its rows are big enough to tap",
      itemHeights.join(","),
    );
    await page.locator(".cm-overlay.mobile").click({ position: { x: 10, y: 10 } });
    await sleep(300);
  }
}

/* -------------------------------------------------------- the info sheet */
await page.locator(".info-fab").click();
await sleep(600);
const infoSheet = page.locator(".backdrop .sheet");
check(await infoSheet.isVisible(), "the info button opens the info sheet");
await shot(page, "06-info-sheet");
await page.locator(".backdrop .close").click();
await sleep(400);

/* ------------------------------------------------------- the more sheet */
await page.locator("header.top button.more").click();
await sleep(600);
check(await page.locator(".backdrop .menu").isVisible(), "the ⋯ button opens the settings sheet");
await shot(page, "07-more-sheet");
const menuText = await page.locator(".backdrop .menu").innerText();
check(/断开|Disconnect/.test(menuText), "the sheet offers disconnect");
// The status bar's settings live in the settings panel; the sheet leads there.
await page.getByTestId("mobile-open-settings").click();
await sleep(600);
const panel = page.locator(".dialog-panel.sheet");
check(await panel.isVisible(), "the sheet opens the settings panel as a bottom sheet");
const tabNames = await panel.locator(".tab .label").allInnerTexts();
check(
  tabNames.length >= 8 && tabNames.every((n) => n.trim().length > 0),
  "every settings tab is labelled",
  tabNames.join(", "),
);
check(
  (await panel.getByTestId("settings-tab-hotkeys").count()) === 0,
  "a phone gets no hotkeys tab",
);
await panel.getByTestId("settings-tab-theme").click();
await sleep(300);
check(
  await panel.locator(".content .presets").isVisible(),
  "a settings pane is readable inside the sheet",
);
await shot(page, "08-settings-panel");
await panel.locator(".close").click();
await sleep(300);

/* ------------------------------------------------ the voice settings */
await page.locator(".voicebar button", { hasText: "⚙️" }).click();
await sleep(600);
check(
  (await page.locator(".dialog-panel.sheet [data-testid=settings-tab-mic].active").count()) === 1,
  "the voice bar gear opens the panel on the microphone tab",
);
await shot(page, "09-voice-settings");
await page.locator(".dialog-panel.sheet .close").click();
await sleep(300);

/* --------------------------------------------------------- back to desktop */
await page.setViewportSize({ width: 1400, height: 900 });
await sleep(1500);
check(
  (await page.locator(".mshell").count()) === 0 &&
    (await page.locator(".dockview-theme-abyss").count()) > 0,
  "widening the window hands the session back to the dock",
);
await shot(page, "10-back-to-desktop");

check(errors.length === 0, "no console errors", errors.slice(0, 3).join(" | "));

await browser.close();
console.log(results.map(([s, n, d]) => `${s}  ${n}${d ? ` — ${d}` : ""}`).join("\n"));
console.log(`\nscreenshots: ${SHOTS}`);
process.exit(results.some(([s]) => s === "FAIL") ? 1 : 0);
