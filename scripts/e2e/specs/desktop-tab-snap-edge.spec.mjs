/**
 * A window dragged by its TAB snaps to the screen's edge, exactly as one
 * dragged by the blank strip of its tab bar does.
 *
 * The bug this pins: a tab drag is native HTML5 drag-and-drop, which fires no
 * pointer events, so the whole of the desktop's snapping — built on pointer
 * events — was blind to it. Dragging a window by its tab, which is what people
 * actually grab, to the left edge and holding it there showed no outline and
 * no preview, and the release left the window wherever it fell. See
 * `useTabDrop.ts` and `dragSnap.ts`, the one decision both drags now share.
 *
 * What is checked is the whole promise, in order: the dashed outline appears
 * first (`snap-dwell`), the solid preview only once the half-second dwell has
 * been served (`snap-preview`), and the release puts the window in exactly the
 * box the preview showed — the left half — moving it rather than rebuilding it.
 *
 * Screen-edge snapping is off by default, so the spec turns it on the way a
 * user does, from its taskbar switch.
 */
import assert from "node:assert/strict";

export const title = "desktop: a window dragged by its tab snaps to the screen's edge";

/** How long a snap waits before it arms; `DWELL_MS` in `snapDwell.ts`. */
const DWELL_MS = 500;
/** How long to wait for either rectangle before calling it missing. */
const SHOW_TIMEOUT_MS = 3_000;

/** Turns a taskbar snap switch on, if it is not already. */
async function switchOn(page, testId) {
  const toggle = page.getByTestId(testId);
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true", `${testId} should be on`);
}

/**
 * Leaves only the named windows on the desktop, so the edge the tab is taken to
 * is empty desktop and not some other window's edge — which would offer a
 * split, and a split outranks the desktop's own snaps.
 */
async function onlyWindows(page, titles) {
  await page.getByTestId("taskbar-minimize-all").click();
  for (const text of titles) {
    await page.locator("[data-testid=taskbar-button]").filter({ hasText: text }).first().click();
  }
  await page.waitForTimeout(200);
}

/**
 * Starts a native drag of a tab and takes it to a point, still held. A handful
 * of small steps after mousedown is what gets Chromium to see a drag rather
 * than a click; see `desktop-tab-stack.spec.mjs`.
 */
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

export default async function desktopTabSnapEdge(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  await page.locator(".dv-tab", { hasText: "Info" }).waitFor({ state: "visible" });
  // Windows the app opens by itself after connecting must be there before the
  // desktop is cleared, or one lands on the desktop mid-drag.
  await page.waitForTimeout(1_500);
  await switchOn(page, "taskbar-snap-edges");
  await onlyWindows(page, ["Info"]);

  const info = overlayByTab(page, "Info");
  const before = await info.boundingBox();
  const groupsBefore = await page.locator(".dv-groupview").count();
  const dock = await page.locator(".dock").boundingBox();
  const dwell = page.getByTestId("snap-dwell");
  const preview = page.getByTestId("snap-preview");

  await holdTabAt(
    page,
    page.locator(".dv-tab", { hasText: "Info" }),
    dock.x + 4,
    dock.y + dock.height / 2,
  );
  const reached = Date.now();
  await dwell.waitFor({ state: "visible", timeout: SHOW_TIMEOUT_MS });
  const outlinedAfter = Date.now() - reached;
  const armedEarly = await preview.isVisible();
  const outline = await dwell.boundingBox();
  await preview.waitFor({ state: "visible", timeout: SHOW_TIMEOUT_MS });
  const armedAfter = Date.now() - reached;
  const promised = await preview.boundingBox();
  await page.mouse.up();
  await page.waitForTimeout(400);
  const after = await info.boundingBox();
  rig.log(
    `outline after ${outlinedAfter}ms ${JSON.stringify(outline)}, ` +
      `preview after ${armedAfter}ms ${JSON.stringify(promised)}, window ${JSON.stringify(after)}`,
  );

  const half = Math.floor(dock.width / 2);
  assert.equal(
    armedEarly,
    false,
    "the outline comes first: nothing is armed until the dwell is served",
  );
  assert.ok(
    near(outline.x, dock.x) && near(outline.width, half) && near(outline.height, dock.height),
    `the outline is the left half, got ${JSON.stringify(outline)}`,
  );
  assert.ok(
    armedAfter >= DWELL_MS - 150,
    `the preview must wait out the dwell, it appeared after ${armedAfter}ms`,
  );
  assert.ok(
    near(promised.x, dock.x) &&
      near(promised.y, dock.y) &&
      near(promised.width, half) &&
      near(promised.height, dock.height),
    `the preview is the left half, got ${JSON.stringify(promised)}`,
  );
  assert.ok(
    near(after.x, promised.x) &&
      near(after.y, promised.y) &&
      near(after.width, promised.width) &&
      near(after.height, promised.height),
    `the window lands in the previewed box: previewed ${JSON.stringify(promised)}, got ${JSON.stringify(after)} (was ${JSON.stringify(before)})`,
  );
  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupsBefore,
    "the lone tab's window was moved, not torn down and rebuilt",
  );
}
