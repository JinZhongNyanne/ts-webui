/**
 * A window dragged by its tab bar and lined up with another window shows where
 * it will go: the dashed outline while the dwell runs, then the solid preview,
 * both painted above the windows.
 *
 * The bug this pins: a window-to-window snap that only MOVES the window —
 * lining it up, filling no gap — promised nothing at all, so after the half
 * second the window simply jumped into line with no shadow first. And the
 * shadows there were sat under every window on the desktop, where a snap
 * flush against a neighbour's edge is exactly the place one cannot be seen.
 * See `dragSnap.ts` and the `--snap-overlay-z` note in `desktop.css`.
 *
 * Info is dragged sideways — dockview's floating-drag tracking is only reliable
 * for a lateral move; see desktop-snap-top.spec.mjs — until its left edge is
 * 8px right of Video's, with Video directly above it. That is a matching-edges
 * alignment beside a window it already sits flush under, and the pocket it is
 * in is its own height, so nothing is filled: the snap moves Info and keeps
 * its size.
 */
import assert from "node:assert/strict";

export const title = "desktop: a window lined up with another shows its shadow first";

/** How long to wait for either rectangle before calling it missing. */
const SHOW_TIMEOUT_MS = 3_000;
/** How far from Video's left edge Info's is taken, inside the 12px reach. */
const OFFSET = 8;

/** Leaves only the named windows on the desktop; see desktop-tab-snap-edge.spec.mjs. */
async function onlyWindows(page, titles) {
  await page.getByTestId("taskbar-minimize-all").click();
  for (const text of titles) {
    await page.locator("[data-testid=taskbar-button]").filter({ hasText: text }).first().click();
  }
  await page.waitForTimeout(200);
}

/** The floating overlay that carries a window's box; see desktop.spec.mjs. */
const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

const near = (a, b, slack = 2) => Math.abs(a - b) <= slack;
const sameBox = (a, b, slack = 2) =>
  near(a.x, b.x, slack) &&
  near(a.y, b.y, slack) &&
  near(a.width, b.width, slack) &&
  near(a.height, b.height, slack);

export default async function desktopSnapWindow(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  await page.locator(".dv-tab", { hasText: "Info" }).waitFor({ state: "visible" });
  await page.waitForTimeout(1_500);
  // Window-to-window snapping is on by default; this spec relies on that.
  assert.equal(
    await page.getByTestId("taskbar-snap-windows").getAttribute("aria-checked"),
    "true",
    "window-to-window snapping starts on",
  );
  await onlyWindows(page, ["Video", "Info"]);

  const info = overlayByTab(page, "Info");
  const video = await overlayByTab(page, "Video").boundingBox();
  const before = await info.boundingBox();
  assert.ok(near(before.y, video.y + video.height), "the fixture needs Info right under Video");
  const expected = { x: video.x, y: before.y, width: before.width, height: before.height };

  const handle = await info.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;
  const shift = before.x - (video.x + OFFSET);
  const dwell = page.getByTestId("snap-dwell");
  const preview = page.getByTestId("snap-preview");

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // dockview takes the pointer-to-corner offset at the first move; see desktop.spec.mjs.
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(grabX - shift, grabY, { steps: 20 });
  const reached = Date.now();
  // A drag that crosses more than one alignment on its way re-keys the outline
  // each time, and the old one takes a moment to fade; the outline that counts
  // is the one left once the drag has come to rest.
  await page.waitForFunction(
    () => document.querySelectorAll("[data-testid=snap-dwell]").length === 1,
    null,
    { timeout: SHOW_TIMEOUT_MS },
  );
  const outlinedAfter = Date.now() - reached;
  const outline = await dwell.boundingBox();
  await preview.waitFor({ state: "visible", timeout: SHOW_TIMEOUT_MS });
  const armedAfter = Date.now() - reached;
  const promised = await preview.boundingBox();
  const layers = await page.evaluate(() => ({
    preview: Number(getComputedStyle(document.querySelector("[data-testid=snap-preview]")).zIndex),
    windows: [...document.querySelectorAll(".dv-resize-container")].map((el) =>
      Number(getComputedStyle(el).zIndex),
    ),
  }));
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await info.boundingBox();
  rig.log(
    `video ${JSON.stringify(video)}; outline after ${outlinedAfter}ms ${JSON.stringify(outline)}, ` +
      `preview after ${armedAfter}ms ${JSON.stringify(promised)} at z ${layers.preview} ` +
      `over windows at ${layers.windows.join(",")}; window ${JSON.stringify(after)}`,
  );

  assert.ok(
    sameBox(outline, expected),
    `the outline shows Info lined up with Video, expected ${JSON.stringify(expected)}, got ${JSON.stringify(outline)}`,
  );
  assert.ok(
    sameBox(promised, expected),
    `the preview shows Info lined up with Video, expected ${JSON.stringify(expected)}, got ${JSON.stringify(promised)}`,
  );
  assert.ok(
    layers.windows.every((z) => layers.preview > z),
    `the shadow is painted above every window: ${layers.preview} vs ${layers.windows.join(",")}`,
  );
  assert.ok(
    sameBox(after, expected),
    `the window lands in the previewed box: expected ${JSON.stringify(expected)}, got ${JSON.stringify(after)}`,
  );
}
