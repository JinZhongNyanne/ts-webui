/**
 * Resizing one window of a snap group resizes the windows snapped to it: the
 * seam between two halves moves, one grows by what the other gives up — and it
 * refuses to move any further once the neighbour is down to its minimum, rather
 * than letting the dragged window slide over it.
 *
 * Then the case a seam shared by *three* windows makes: the `left-stack` layout
 * parks a tall window on the left and two stacked ones on the right, all three
 * with an edge on the same vertical line. Dragging that line has to move all of
 * them — including the window on the same side as the dragged one, which would
 * otherwise be left behind overlapping the window that did follow.
 *
 * The windows are parked by the Snap Layouts flyout rather than by dragging
 * them, for the reason `desktop-snap-layouts-hover.spec.mjs` gives: a window
 * *move* drag is only reliable once per page session, and this spec needs its
 * one drag for the resize itself.
 *
 * **Which window a press on a seam belongs to.** Both windows' handles overlap
 * on the seam line, so the press lands on whichever window is in front — not
 * necessarily the one whose handle was measured. This spec once measured the
 * left window's right handle, pressed there, and was in fact dragging the right
 * window's *left* edge, because that window had been parked last; the unit fakes
 * press exactly the handle they name and could not see it. So `dragEdge` now
 * asserts the handle under the pointer is the one it was asked for, and the seam
 * is pulled from both sides: from the side of the window being squeezed, where
 * its own minimum is what stops the seam, and from the other, where the
 * neighbour's is.
 */
import assert from "node:assert/strict";

/** The floating overlay that actually carries a window's box; see desktop.spec.mjs. */
const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

const groupByTab = (page, tabText) =>
  page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: tabText }) });

/** `MIN_WINDOW_EXTENT` from `apps/web/src/dock/box.ts`: the seam's stopping point. */
const MIN_WINDOW_EXTENT = 160;

/** Whether the element under that point is that window's own handle for that direction. */
const handleUnder = (page, overlay, direction, x, y) =>
  overlay.evaluate(
    (element, [className, px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return !!hit && element.contains(hit) && hit.classList.contains(className);
    },
    [`dv-resize-handle-${direction}`, x, y],
  );

/**
 * A point on that window's handle for that direction which a press would really
 * land on, or `null` if there is none.
 *
 * The handle is 4px straddling the window's edge, and on a seam the other
 * window's handle and content cover parts of it: which window owns a given
 * pixel of the seam depends on stacking, and the rig once pressed the wrong
 * one without knowing. So the handle is walked across its short side, and only
 * a point `elementFromPoint` attributes to it is used.
 */
async function grabPoint(page, overlay, direction) {
  const handle = await overlay.locator(`.dv-resize-handle-${direction}`).boundingBox();
  const across = handle.width < handle.height;
  const y = handle.y + handle.height / 2;
  const x = handle.x + handle.width / 2;
  const span = across ? handle.width : handle.height;
  for (let offset = 0.5; offset < span; offset += 0.5) {
    const point = across ? { x: handle.x + offset, y } : { x, y: handle.y + offset };
    if (await handleUnder(page, overlay, direction, point.x, point.y)) return point;
  }
  return null;
}

/**
 * Grabs one of that window's side handles and pulls it `shift` pixels rightwards,
 * having first made sure the press will really land on that handle.
 */
async function dragEdge(page, overlay, direction, shift) {
  const point = await grabPoint(page, overlay, direction);
  assert.ok(
    point,
    `no point of that window's ${direction} handle is uncovered — another window is in front of it`,
  );
  const { x: grabX, y: grabY } = point;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // dockview captures its `startPosition` on the first move, so the gesture
  // needs one small move before the real one.
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(grabX + shift, grabY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Sets one of the taskbar's snap switches, whatever it was. */
async function setSwitch(page, testId, on) {
  const button = page.getByTestId(testId);
  if ((await button.getAttribute("aria-checked")) !== String(on)) await button.click();
  assert.equal(await button.getAttribute("aria-checked"), String(on), `${testId} should be ${on}`);
}

/** Brings a window to the front from its taskbar button, so its handles are the ones on top. */
async function raise(page, panelId) {
  await page.locator(`[data-testid=taskbar-button][data-panel="${panelId}"]`).click();
  await page.waitForTimeout(150);
}

const tileFor = (page, layout, zone) =>
  page.locator(`[data-testid=snap-layout-zone][data-layout="${layout}"][data-zone="${zone}"]`);

/** Parks that window in one region of one layout, through the hover flyout. */
async function snapVia(page, tabText, layout, zone) {
  const panel = page.locator("[data-testid=snap-layouts]");
  const dock = await page.locator(".dock").boundingBox();
  // The flyout opens on the pointer entering the button, so it has to be
  // somewhere else first for the hover to count as one.
  await page.mouse.move(dock.x + dock.width / 2, dock.y + dock.height - 20);
  await groupByTab(page, tabText).getByTestId("dock-maximize").hover();
  await panel.waitFor({ state: "visible", timeout: 5_000 });
  await tileFor(page, layout, zone).click();
  await panel.waitFor({ state: "hidden", timeout: 5_000 });
  await page.waitForTimeout(250);
}

export const title =
  "desktop: resizing a snapped window resizes every window on the seam, and stops at their minimum";

/**
 * The seam held at `wall`: the right window left at the minimum and the two
 * still flush, whichever side the seam was pulled from.
 */
async function assertHeldAtWall(leftOverlay, rightOverlay, wall) {
  const held = await leftOverlay.boundingBox();
  const squeezed = await rightOverlay.boundingBox();
  assert.ok(
    Math.abs(held.x + held.width - wall) <= 6,
    `the seam should have stopped at ${wall}, went to ${held.x + held.width}`,
  );
  assert.ok(
    Math.abs(squeezed.width - MIN_WINDOW_EXTENT) <= 6,
    `the squeezed window should be left at exactly ${MIN_WINDOW_EXTENT}, is ${squeezed.width}`,
  );
  assert.ok(
    Math.abs(held.x + held.width - squeezed.x) <= 6,
    `the two should still share the seam: the left one ends at ${held.x + held.width}, the right one starts at ${squeezed.x}`,
  );
}

export default async function desktopSnapGroupResize(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });

  // The seam resize is on whenever either switch is. Set them explicitly rather
  // than trusting the defaults, which have changed before: window-to-window on,
  // screen edges off. Every edge dragged below is on a seam, and a seamed edge
  // never snaps, so neither switch can move where these edges land.
  await setSwitch(page, "taskbar-snap-windows", true);
  await setSwitch(page, "taskbar-snap-edges", false);

  await snapVia(page, "Channels & users", "even", "left");
  await snapVia(page, "Video", "even", "right");

  const leftOverlay = overlayByTab(page, "Channels & users");
  const rightOverlay = overlayByTab(page, "Video");
  const before = await rightOverlay.boundingBox();
  const left = await leftOverlay.boundingBox();

  // Video was parked last, so it is in front and the press on the seam is on its
  // *left* handle: the right window's left edge, pulled rightwards.
  const shift = 120;
  await dragEdge(page, rightOverlay, "left", shift);

  const grown = await leftOverlay.boundingBox();
  const followed = await rightOverlay.boundingBox();

  assert.ok(
    Math.abs(grown.width - (left.width + shift)) <= 4,
    `the dragged window should have grown by ${shift}, went from ${left.width} to ${grown.width}`,
  );
  assert.ok(
    Math.abs(followed.x - (before.x + shift)) <= 4,
    `the neighbour's left edge should have followed the seam to ${before.x + shift}, is at ${followed.x}`,
  );
  assert.ok(
    Math.abs(followed.x + followed.width - (before.x + before.width)) <= 4,
    "the neighbour's far edge should not have moved",
  );

  // Now pull the same seam far past the point where Video runs out of room.
  // Video is the window being dragged *and* the one being squeezed, so its own
  // minimum is what has to stop the seam — the case that ran on to 1318.
  const wall = followed.x + followed.width - MIN_WINDOW_EXTENT;
  await dragEdge(page, rightOverlay, "left", 500);
  await assertHeldAtWall(leftOverlay, rightOverlay, wall);

  // Give it its width back — the same seam, pushed the other way — and pull it
  // again from the other side: the tree in front, its right edge dragged, and
  // Video's minimum stopping it as the *neighbour's* now.
  await dragEdge(page, rightOverlay, "left", -400);
  await raise(page, "tree");
  await dragEdge(page, leftOverlay, "right", 500);
  await assertHeldAtWall(leftOverlay, rightOverlay, wall);
  await dragEdge(page, leftOverlay, "right", -400);

  // Three windows on one seam: the channel tree tall on the left, Video and Info
  // stacked on the right, so that tree.right, Video.left and Info.left are all
  // the same vertical line. Info starts underneath Video, so it is raised to be
  // parked, and Video is parked last so its handle is the one on the seam.
  await raise(page, "info");
  await snapVia(page, "Info", "left-stack", "right-bottom");
  await snapVia(page, "Channels & users", "left-stack", "left");
  await snapVia(page, "Video", "left-stack", "right-top");

  const infoOverlay = overlayByTab(page, "Info");
  const tallBefore = await leftOverlay.boundingBox();
  const topBefore = await rightOverlay.boundingBox();
  const bottomBefore = await infoOverlay.boundingBox();

  // Pull the *top right* window's left edge leftwards: the seam is shared, so
  // the tall window gives up the space and the window below moves with it.
  const pull = 100;
  await dragEdge(page, rightOverlay, "left", -pull);

  const tall = await leftOverlay.boundingBox();
  const top = await rightOverlay.boundingBox();
  const bottom = await infoOverlay.boundingBox();

  assert.ok(
    Math.abs(top.x - (topBefore.x - pull)) <= 4,
    `the dragged window's left edge should have moved to ${topBefore.x - pull}, is at ${top.x}`,
  );
  assert.ok(
    Math.abs(tall.x + tall.width - (tallBefore.x + tallBefore.width - pull)) <= 4,
    `the tall window's right edge should have followed the seam to ${tallBefore.x + tallBefore.width - pull}, is at ${tall.x + tall.width}`,
  );
  assert.ok(
    Math.abs(bottom.x - (bottomBefore.x - pull)) <= 4,
    `the window below the dragged one shares the seam and should have followed it to ${bottomBefore.x - pull}, is at ${bottom.x}`,
  );
  assert.ok(
    Math.abs(bottom.x + bottom.width - (bottomBefore.x + bottomBefore.width)) <= 4,
    "the window below should have kept its far edge where it was",
  );
  assert.ok(
    Math.abs(bottom.x - top.x) <= 4,
    `the two stacked windows should still share one seam: ${top.x} against ${bottom.x}`,
  );
}
