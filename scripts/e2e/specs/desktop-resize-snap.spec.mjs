/**
 * Resizing a window snaps its dragged edge: the edge follows the pointer while
 * the snap preview shows where it would land, and letting go puts it there —
 * exactly on the neighbour's edge. Let go out of reach and nothing is snapped:
 * the window keeps exactly the size dockview's own gesture gave it.
 *
 * The two windows are parked a third of the desktop apart by the Snap Layouts
 * flyout (`wide-right`'s left third, `wide-left`'s right third), which leaves a
 * wide strip of wallpaper between the channel tree's right edge and Video's left
 * edge for the resize to cross. See `desktop-snap-group-resize.spec.mjs` for why
 * the windows are parked through the flyout, and why every press is checked to
 * land on the handle it means.
 */
import assert from "node:assert/strict";

/** `WINDOW_SNAP_DISTANCE` from `apps/web/src/dock/windowSnap.ts`: the reach of a snap. */
const WINDOW_SNAP_DISTANCE = 12;

/** How far short of the neighbour the in-reach release stops: well inside the reach. */
const IN_REACH = 8;

/** How far short the out-of-reach release stops: well outside it. */
const OUT_OF_REACH = 60;

const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

const groupByTab = (page, tabText) =>
  page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: tabText }) });

const tileFor = (page, layout, zone) =>
  page.locator(`[data-testid=snap-layout-zone][data-layout="${layout}"][data-zone="${zone}"]`);

/** Parks that window in one region of one layout, through the hover flyout. */
async function snapVia(page, tabText, layout, zone) {
  const panel = page.locator("[data-testid=snap-layouts]");
  const dock = await page.locator(".dock").boundingBox();
  await page.mouse.move(dock.x + dock.width / 2, dock.y + dock.height - 20);
  await groupByTab(page, tabText).getByTestId("dock-maximize").hover();
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  await tileFor(page, layout, zone).click();
  await panel.waitFor({ state: "hidden", timeout: 5_000 });
  await page.waitForTimeout(250);
}

/** Sets one of the taskbar's snap switches, whatever it was. */
async function setSwitch(page, testId, on) {
  const button = page.getByTestId(testId);
  if ((await button.getAttribute("aria-checked")) !== String(on)) await button.click();
  assert.equal(await button.getAttribute("aria-checked"), String(on), `${testId} should be ${on}`);
}

/** Whether the element under that point is that window's own handle for that direction. */
const handleUnder = (overlay, direction, x, y) =>
  overlay.evaluate(
    (element, [className, px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return !!hit && element.contains(hit) && hit.classList.contains(className);
    },
    [`dv-resize-handle-${direction}`, x, y],
  );

/** A point of that window's side handle a press would really land on; see the seam spec. */
async function grabPoint(overlay, direction) {
  const handle = await overlay.locator(`.dv-resize-handle-${direction}`).boundingBox();
  const y = handle.y + handle.height / 2;
  for (let offset = 0.5; offset < handle.width; offset += 0.5) {
    if (await handleUnder(overlay, direction, handle.x + offset, y)) {
      return { x: handle.x + offset, y };
    }
  }
  assert.fail(`no point of that window's ${direction} handle is uncovered`);
}

/**
 * Presses that window's right handle and moves it until the right edge would be
 * at `right`, leaving the button held so the preview can be read.
 *
 * dockview takes its `startPosition` from the first move, not from the press, so
 * the gesture makes a 1px move first and the edge then travels by exactly what
 * the pointer does after it.
 */
async function holdRightEdgeAt(page, overlay, right) {
  const box = await overlay.boundingBox();
  const grab = await grabPoint(overlay, "right");
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + 1, grab.y);
  const target = grab.x + 1 + (right - (box.x + box.width));
  await page.mouse.move(target, grab.y, { steps: 20 });
  // The preview fades and grows in over 200ms; read it once it has settled.
  await page.waitForTimeout(400);
}

async function release(page) {
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Every visible floating window's box but the one named: all the edges a snap could reach. */
async function otherWindowEdges(page, exceptTab) {
  const overlays = page.locator(".dv-resize-container:visible");
  const edges = [];
  for (const overlay of await overlays.all()) {
    const tabs = await overlay.locator(".dv-tab").allInnerTexts();
    if (tabs.some((tab) => tab.includes(exceptTab))) continue;
    const box = await overlay.boundingBox();
    if (box) edges.push(box.x, box.x + box.width);
  }
  return edges;
}

/** Fails unless no window edge but `target` (if any) lies within reach of `x`. */
function assertOnlyTargetNear(edges, x, target, what) {
  const stray = edges.filter(
    (edge) =>
      (target === null || Math.abs(edge - target) > 0.5) &&
      Math.abs(edge - x) <= WINDOW_SNAP_DISTANCE + 2,
  );
  assert.deepEqual(stray, [], `${what}: another window's edge is within reach of ${x}`);
}

export const title =
  "desktop: resizing a window snaps its edge to a neighbour's on release, and nothing out of reach";

export default async function desktopResizeSnap(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });

  // Resize snapping follows the same switches as a move: window-to-window on,
  // screen edges off, set explicitly rather than trusting the defaults.
  await setSwitch(page, "taskbar-snap-windows", true);
  await setSwitch(page, "taskbar-snap-edges", false);

  // Video in the right third, the tree in the left third — parked last, so its
  // right handle is the one in front.
  await snapVia(page, "Video", "wide-left", "right");
  await snapVia(page, "Channels & users", "wide-right", "left");

  const tree = overlayByTab(page, "Channels & users");
  const video = overlayByTab(page, "Video");
  const neighbour = await video.boundingBox();
  const seam = neighbour.x;
  const edges = await otherWindowEdges(page, "Channels & users");

  // Out of reach first: while the right edge is still free. No preview, and the
  // release leaves the window exactly where the pointer took it.
  const start = await tree.boundingBox();
  const loose = seam - OUT_OF_REACH;
  assertOnlyTargetNear(edges, loose, null, "the out-of-reach release");
  await holdRightEdgeAt(page, tree, loose);
  assert.equal(
    await page.getByTestId("snap-preview").count(),
    0,
    "no preview should show with nothing in reach",
  );
  await release(page);
  const unsnapped = await tree.boundingBox();
  console.log(
    `  · out of reach: released at ${loose}, right edge at ${unsnapped.x + unsnapped.width}`,
  );
  assert.ok(
    Math.abs(unsnapped.x + unsnapped.width - loose) <= 1,
    `a release out of reach should leave the edge where it was dragged, ${loose}; it is at ${unsnapped.x + unsnapped.width}`,
  );
  assert.equal(unsnapped.x, start.x, "the left edge should not have moved");

  // In reach: 8px short of Video's left edge, and nothing else nearby.
  const near = seam - IN_REACH;
  assertOnlyTargetNear(edges, near, seam, "the in-reach release");
  await holdRightEdgeAt(page, tree, near);
  const preview = page.getByTestId("snap-preview");
  await preview.waitFor({ state: "visible", timeout: 2_000 });
  const promised = await preview.boundingBox();
  const held = await tree.boundingBox();
  console.log(
    `  · in reach: edge held at ${held.x + held.width}, preview ends at ${promised.x + promised.width}, neighbour starts at ${seam}`,
  );
  assert.ok(
    Math.abs(held.x + held.width - near) <= 1,
    `the edge should follow the pointer while held, to ${near}; it is at ${held.x + held.width}`,
  );
  assert.ok(
    Math.abs(promised.x + promised.width - seam) <= 1,
    `the preview should end on the neighbour's edge, ${seam}; it ends at ${promised.x + promised.width}`,
  );
  assert.ok(
    Math.abs(promised.x - held.x) <= 1,
    `the preview should keep the window's left edge, ${held.x}; it starts at ${promised.x}`,
  );

  await release(page);
  const snapped = await tree.boundingBox();
  const after = await video.boundingBox();
  console.log(`  · released: right edge at ${snapped.x + snapped.width}, neighbour at ${after.x}`);
  assert.ok(
    Math.abs(snapped.x + snapped.width - seam) <= 0.5,
    `the release should land the edge exactly on ${seam}; it is at ${snapped.x + snapped.width}`,
  );
  assert.equal(snapped.x, start.x, "the left edge should not have moved");
  assert.deepEqual(after, neighbour, "the neighbour should not have moved");
  assert.equal(await preview.count(), 0, "the preview should be gone after the release");
}
