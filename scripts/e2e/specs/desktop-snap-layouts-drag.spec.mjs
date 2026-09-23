/**
 * Snap Layouts, trigger two: dragging a window against the top edge drops the
 * flyout from the top, and releasing over one of its regions snaps there.
 *
 * Releasing at the top edge but *not* over a tile still fills the desktop —
 * that is desktop-snap-top.spec.mjs, which this must not break.
 *
 * A fresh connect and one drag, and Video for the drag, for the reasons
 * desktop-snap-top.spec.mjs sets out: dockview's floating-drag tracking is not
 * reliable across two window moves in one page session, nor across a long
 * vertical move.
 */
import assert from "node:assert/strict";

export const title =
  "desktop: dragging to the top edge offers Snap Layouts, and a tile snaps there";

/**
 * How long to wait for the flyout. It drops when the top edge ARMS, which is
 * only once the drag has rested there for the dwell (`snapDwell.ts`), so the
 * spec waits for the panel itself rather than sleeping a fixed time.
 */
const PANEL_TIMEOUT_MS = 3_000;

/**
 * Turns on screen-edge snapping from its taskbar switch, the way a user does:
 * it is off by default (`snapMode.ts`), and this spec is about it.
 */
async function snapToEdgesOn(page) {
  const toggle = page.getByTestId("taskbar-snap-edges");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true", "screen-edge snapping is on");
}

/** The floating overlay that actually carries a window's box; see desktop.spec.mjs. */
const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

export default async function desktopSnapLayoutsDrag(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  const videoOverlay = overlayByTab(page, "Video");
  await videoOverlay.waitFor({ state: "visible" });
  await snapToEdgesOn(page);

  const dock = await page.locator(".dock").boundingBox();
  const panel = page.locator("[data-testid=snap-layouts]");
  const handle = await videoOverlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // dockview tracks the window by the offset between the pointer and the
  // overlay's corner at the first move after mousedown; see desktop.spec.mjs.
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(dock.x + dock.width / 2, dock.y + 3, { steps: 20 });
  const dropped = await panel
    .waitFor({ state: "visible", timeout: PANEL_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);

  assert.ok(dropped, "the top edge drops the Snap Layouts panel from the top");
  const panelBox = await panel.boundingBox();
  assert.ok(
    panelBox.y > dock.y + 3,
    `the panel hangs clear of the top edge itself, so releasing there still maximises; its top was ${panelBox.y} against an edge at ${dock.y}`,
  );

  // Reach down from the edge to the bottom-right quadrant of the quarters
  // layout. The panel has to survive the pointer leaving the edge band.
  const tile = page.locator(
    '[data-testid=snap-layout-zone][data-layout="quarters"][data-zone="bottom-right"]',
  );
  const tileBox = await tile.boundingBox();
  await page.mouse.move(tileBox.x + tileBox.width / 2, tileBox.y + tileBox.height / 2, {
    steps: 10,
  });
  await page.waitForTimeout(200);
  assert.ok(await panel.isVisible(), "the panel stays up while the pointer is on it");

  await page.mouse.up();
  await page.waitForTimeout(400);
  assert.equal(await panel.count(), 0, "the panel goes away when the drag ends");

  const half = Math.floor(dock.width / 2);
  const middle = Math.floor(dock.height / 2);
  const snapped = await videoOverlay.boundingBox();
  assert.ok(
    Math.abs(snapped.x - (dock.x + half)) <= 2 &&
      Math.abs(snapped.y - (dock.y + middle)) <= 2 &&
      Math.abs(snapped.width - (dock.width - half)) <= 2 &&
      Math.abs(snapped.height - (dock.height - middle)) <= 2,
    `releasing over the bottom-right quadrant should give ${dock.width - half}x${dock.height - middle} at (${dock.x + half},${dock.y + middle}), got ${JSON.stringify(snapped)}`,
  );
}
