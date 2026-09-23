/**
 * Dragging a window into a corner of the desktop snaps it to a quarter.
 *
 * A fresh connect, one drag: dockview's floating-drag pointer tracking was
 * found (while writing this spec) not to reliably survive a *second*
 * window-move drag in the same page session — the window stops following the
 * pointer, from barely moving to landing somewhere unrelated to where it was
 * dropped, and the snap preview does not show. That is a real bug, reported
 * separately; every drag-based desktop spec sticks to one window-move per
 * page load to test its own gesture without tripping over it.
 */
import assert from "node:assert/strict";

export const title = "desktop: dragging a window into a corner snaps it to a quarter";

/**
 * How long to hold for the preview. Every snap waits out a half-second dwell
 * (`snapDwell.ts`) before it arms, so the spec waits for the preview itself
 * rather than sleeping a fixed time, and gives up well after the dwell.
 */
const PREVIEW_TIMEOUT_MS = 3_000;

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

export default async function desktopSnapCorner(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  const videoOverlay = overlayByTab(page, "Video");
  await videoOverlay.waitFor({ state: "visible" });
  await snapToEdgesOn(page);

  const dock = await page.locator(".dock").boundingBox();
  const handle = await videoOverlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // dockview tracks the window by the offset between the pointer and the
  // overlay's corner at the first move after mousedown, so that offset has to
  // be captured near the grab point; see desktop.spec.mjs.
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(dock.x + 3, dock.y + 3, { steps: 20 });
  const previewVisible = await page
    .locator("[data-testid=snap-preview]")
    .waitFor({ state: "visible", timeout: PREVIEW_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  await page.mouse.up();
  await page.waitForTimeout(300);

  assert.ok(previewVisible, "a corner shows the snap preview");
  const corner = await videoOverlay.boundingBox();
  const half = Math.floor(dock.width / 2);
  const quarterHeight = Math.floor(dock.height / 2);
  assert.ok(
    Math.abs(corner.x - dock.x) <= 2 &&
      Math.abs(corner.y - dock.y) <= 2 &&
      Math.abs(corner.width - half) <= 2 &&
      Math.abs(corner.height - quarterHeight) <= 2,
    `a corner should take a quarter of the desktop, took ${corner.width}x${corner.height} at (${corner.x},${corner.y})`,
  );
}
