/**
 * Dragging a window against the top edge of the desktop fills it.
 *
 * A fresh connect, one drag — see desktop-snap-corner.spec.mjs for why this
 * spec does not also cover the corner (or any other) snap in the same run.
 *
 * This drags Video, which the starter desktop already places flush against
 * the top edge, rather than Info or Server (both start at the bottom of the
 * starter layout): dragging one of those the ~380px up to the top edge was
 * found, while writing this spec, to land the window somewhere unrelated to
 * the drop point — sometimes barely moved, once in a quarter-sized box that
 * matches no zone this drag could arm — with the snap preview never showing.
 * That reproduced from a single drag on a fresh page load, so it is a real
 * tracking bug in a long vertical floating-window drag, not a spec artefact;
 * it is reported separately rather than papered over here. Video only needs
 * a lateral move to reach the top-centre, which is unaffected.
 */
import assert from "node:assert/strict";

export const title = "desktop: dragging a window against the top edge fills the desktop";

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

export default async function desktopSnapTop(rig) {
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
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(dock.x + dock.width / 2, dock.y + 3, { steps: 20 });
  const previewVisible = await page
    .locator("[data-testid=snap-preview]")
    .waitFor({ state: "visible", timeout: PREVIEW_TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  await page.mouse.up();
  await page.waitForTimeout(300);

  assert.ok(previewVisible, "the top edge shows the snap preview");
  const top = await videoOverlay.boundingBox();
  assert.ok(
    Math.abs(top.width - dock.width) <= 2 && Math.abs(top.height - dock.height) <= 2,
    `the top edge should fill the desktop, took ${top.width}x${top.height} of ${dock.width}x${dock.height}`,
  );
}
