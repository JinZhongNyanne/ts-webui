/**
 * A window dragged by its TAB lines up with another window's edge, and shows
 * where it will land before it does.
 *
 * Window-to-window snapping is on by default. A tab drag moves nothing until
 * it is let go — HTML5 drag-and-drop only carries a ghost image — so what is
 * lined up is the window-to-be: the box the release would put the window in
 * (`landingBoxFor` in `floatDrop.ts`), which for a tab alone in its window is
 * that window, at its own size, under the pointer. The shadow is the only way
 * to see where it will go, which is why a snap that merely moves a window —
 * aligns it, filling nothing — now shows one too (`dragSnap.ts`).
 *
 * The drag takes Info's tab to where its window would sit with its left edge
 * 5px right of the Server window's left edge, the two stacked one above the
 * other: a matching-edges alignment, which never resizes. The outline, the
 * preview and the landed window must all be that box, aligned flush.
 */
import assert from "node:assert/strict";

export const title = "desktop: a window dragged by its tab lines up with another window";

/** How long to wait for either rectangle before calling it missing. */
const SHOW_TIMEOUT_MS = 3_000;
/** How far from the neighbour's edge the unsnapped window-to-be is aimed. */
const OFFSET = 5;
/** How far above the cursor a dropped window's top edge lands; `FLOAT_GRAB_OFFSET`. */
const GRAB_OFFSET = 16;

/** Turns a taskbar snap switch on, if it is not already. */
async function switchOn(page, testId) {
  const toggle = page.getByTestId(testId);
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true", `${testId} should be on`);
}

/** Leaves only the named windows on the desktop; see desktop-tab-snap-edge.spec.mjs. */
async function onlyWindows(page, titles) {
  await page.getByTestId("taskbar-minimize-all").click();
  for (const text of titles) {
    await page.locator("[data-testid=taskbar-button]").filter({ hasText: text }).first().click();
  }
  await page.waitForTimeout(200);
}

/** Starts a native drag of a tab and takes it to a point, still held. */
async function holdTabAt(page, tab, x, y) {
  const box = await tab.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX + i * 2, startY + i, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.move(x, y, { steps: 20 });
  // Playwright's drag emulation hands the page the `dragover` for a move only
  // with the NEXT input event, and a held-still drag repeats nothing, so a drag
  // parked exactly on its target would never report being there. One pixel
  // further along is the event that delivers it, and is well inside every
  // snap's reach and the dwell's own tolerance.
  await page.mouse.move(x, y + 1);
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

export default async function desktopTabSnapWindow(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  await page.locator(".dv-tab", { hasText: "Info" }).waitFor({ state: "visible" });
  await page.waitForTimeout(1_500);
  await switchOn(page, "taskbar-snap-windows");
  await onlyWindows(page, ["Server", "Info"]);

  const info = overlayByTab(page, "Info");
  const server = overlayByTab(page, "Server");
  const before = await info.boundingBox();
  const wall = await server.boundingBox();
  const dock = await page.locator(".dock").boundingBox();
  // Info's window-to-be is centred on the pointer with its top edge
  // GRAB_OFFSET above it; aim it OFFSET right of Server's left edge, at the top
  // of the desktop, clear of Server vertically so nothing is abutted and
  // nothing can be filled.
  const aimX = wall.x + OFFSET + before.width / 2;
  const aimY = dock.y + GRAB_OFFSET + 10;
  const expected = { x: wall.x, y: dock.y + 10, width: before.width, height: before.height };
  // Nothing on the vertical axis may be within reach, or the snap would move
  // Info up or down as well: its bottom must be well clear of Server's top.
  assert.ok(
    Math.abs(wall.y - expected.height - expected.y) > 40,
    "the fixture needs Info's bottom edge well clear of Server's top edge",
  );

  const dwell = page.getByTestId("snap-dwell");
  const preview = page.getByTestId("snap-preview");
  await holdTabAt(page, page.locator(".dv-tab", { hasText: "Info" }), aimX, aimY);
  const reached = Date.now();
  await dwell.waitFor({ state: "visible", timeout: SHOW_TIMEOUT_MS });
  const outlinedAfter = Date.now() - reached;
  const outline = await dwell.boundingBox();
  await preview.waitFor({ state: "visible", timeout: SHOW_TIMEOUT_MS });
  const armedAfter = Date.now() - reached;
  const promised = await preview.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await info.boundingBox();
  rig.log(
    `server ${JSON.stringify(wall)}; outline after ${outlinedAfter}ms ${JSON.stringify(outline)}, ` +
      `preview after ${armedAfter}ms ${JSON.stringify(promised)}, window ${JSON.stringify(after)}`,
  );

  assert.ok(
    sameBox(outline, expected),
    `the outline shows Info aligned with Server's left edge, expected ${JSON.stringify(expected)}, got ${JSON.stringify(outline)}`,
  );
  assert.ok(
    sameBox(promised, expected),
    `the preview shows Info aligned with Server's left edge, expected ${JSON.stringify(expected)}, got ${JSON.stringify(promised)}`,
  );
  assert.ok(
    sameBox(after, promised),
    `the window lands in the previewed box: previewed ${JSON.stringify(promised)}, got ${JSON.stringify(after)}`,
  );
  assert.ok(
    near(after.width, before.width) && near(after.height, before.height),
    `an alignment moves the window and keeps its size, was ${before.width}x${before.height}`,
  );
}
