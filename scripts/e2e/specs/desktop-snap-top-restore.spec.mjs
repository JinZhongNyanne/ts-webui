/**
 * A window filled by dragging it to the top edge is genuinely MAXIMISED: the
 * maximise button becomes a restore button, shows its own glyph, and puts the
 * window back in the box it had before the drag.
 *
 * The bug this pins: the top-edge snap only *moved* the window, so the state
 * still called it un-maximised. The next press of the button then maximised a
 * window that was already the size of the desktop, stored the desktop itself
 * as the box to come back to, and left the window full-screen for good.
 *
 * Drags Video, and only sideways, for the reason desktop-snap-top.spec.mjs
 * gives: a long vertical floating-window drag tracks badly.
 */
import assert from "node:assert/strict";

export const title = "desktop: a window filled from the top edge restores to its pre-drag box";

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

/** A window is found by its TAB; see desktop-maximize-persist.spec.mjs. */
const groupByTab = (page, tabText) =>
  page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: tabText }) });

export default async function desktopSnapTopRestore(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  const videoOverlay = overlayByTab(page, "Video");
  await videoOverlay.waitFor({ state: "visible" });
  await snapToEdgesOn(page);
  const videoButton = groupByTab(page, "Video").getByTestId("dock-maximize");

  const dock = await page.locator(".dock").boundingBox();
  const before = await videoOverlay.boundingBox();
  const maximizeGlyph = (await videoButton.innerText()).trim();

  const handle = await videoOverlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(dock.x + dock.width / 2, dock.y + 3, { steps: 20 });
  // The top edge arms only once the drag has rested there; released before
  // that, the window is merely dropped.
  await page
    .locator("[data-testid=snap-preview]")
    .waitFor({ state: "visible", timeout: PREVIEW_TIMEOUT_MS });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const filled = await videoOverlay.boundingBox();
  assert.ok(
    Math.abs(filled.width - dock.width) <= 2 && Math.abs(filled.height - dock.height) <= 2,
    `the top edge should fill the desktop, took ${filled.width}x${filled.height} of ${dock.width}x${dock.height}`,
  );

  const restoreGlyph = (await videoButton.innerText()).trim();
  assert.notEqual(
    restoreGlyph,
    maximizeGlyph,
    `a filled window shows its own restore glyph, not the maximise one (${maximizeGlyph})`,
  );
  assert.ok(restoreGlyph.length > 0, "the restore glyph is not empty");

  await videoButton.click();
  await page.waitForTimeout(300);
  const restored = await videoOverlay.boundingBox();
  assert.ok(
    Math.abs(restored.x - before.x) <= 3 &&
      Math.abs(restored.y - before.y) <= 3 &&
      Math.abs(restored.width - before.width) <= 3 &&
      Math.abs(restored.height - before.height) <= 3,
    `restore should return to the pre-drag box, was ${JSON.stringify(restored)} not ${JSON.stringify(before)}`,
  );
  assert.equal(
    (await videoButton.innerText()).trim(),
    maximizeGlyph,
    "a restored window shows the maximise glyph again",
  );
}
