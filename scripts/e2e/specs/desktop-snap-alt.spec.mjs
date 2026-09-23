/**
 * Holding Alt while dragging a window against an edge suspends snapping.
 *
 * A fresh connect, one drag — see desktop-snap-corner.spec.mjs for why this
 * spec does not also cover another snap gesture in the same run.
 */
import assert from "node:assert/strict";

export const title = "desktop: Alt suspends snapping, dropping the window where the pointer is";

/**
 * How long the drag is held at the edge before checking for a preview: past the
 * half-second dwell every snap waits out (`snapDwell.ts`) and then some, so a
 * preview that was going to appear has had every chance to. This is the one
 * place a fixed wait is right, because what is being shown is an absence.
 */
const HOLD_MS = 1_000;

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

export default async function desktopSnapAlt(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  const serverChatOverlay = overlayByTab(page, "Server");
  await serverChatOverlay.waitFor({ state: "visible" });
  // Alt has to be seen suspending something that would otherwise act.
  await snapToEdgesOn(page);

  const dock = await page.locator(".dock").boundingBox();
  const before = await serverChatOverlay.boundingBox();
  const handle = await serverChatOverlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(grabX + 1, grabY);
  await page.mouse.move(dock.x + 3, dock.y + dock.height / 2, { steps: 20 });
  await page.waitForTimeout(HOLD_MS);
  const previewVisible = await page
    .locator("[data-testid=snap-preview]")
    .isVisible()
    .catch(() => false);
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(300);

  assert.equal(previewVisible, false, "holding Alt against an edge shows no snap preview");
  const after = await serverChatOverlay.boundingBox();
  assert.ok(
    Math.abs(after.width - before.width) <= 1 && Math.abs(after.height - before.height) <= 1,
    "Alt drops the window at its own size, not snapped to an edge",
  );
}
