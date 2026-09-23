/**
 * Maximise/restore, layout persistence across a reload, and the layout
 * reset — none of which involve dragging a window, so unlike the snap specs
 * this one is free to check all three in a single page session.
 */
import assert from "node:assert/strict";

export const title =
  "desktop: maximise/restore is exact, layout survives a reload, reset rebuilds it";

const taskbarFor = (page, panelId) =>
  page.locator(`[data-testid=taskbar-button][data-panel="${panelId}"]`);

/** The floating overlay that actually carries a window's box; see desktop.spec.mjs. */
const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

export default async function desktopMaximizePersist(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });

  const dock = await page.locator(".dock").boundingBox();

  /* ------------------------------------------------ maximise / restore */
  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor({ state: "visible" });
  // A window is found by its TAB, not by its content: `default-renderer="always"`
  // renders panel content into a shared overlay beside the frames, so the
  // content is no longer a descendant of its own `.dv-groupview`.
  const soundGroup = page.locator(".dv-groupview", {
    has: page.locator(".dv-tab", { hasText: "Soundboard" }),
  });
  const soundOverlay = overlayByTab(page, "Soundboard");

  const beforeMaximize = await soundOverlay.boundingBox();
  await soundGroup.getByTestId("dock-maximize").click();
  await page.waitForTimeout(200);
  const maximized = await soundOverlay.boundingBox();
  assert.ok(
    Math.abs(maximized.width - dock.width) <= 2 && Math.abs(maximized.height - dock.height) <= 2,
    `maximised window should fill the desktop, was ${maximized.width}x${maximized.height} of ${dock.width}x${dock.height}`,
  );

  await soundGroup.getByTestId("dock-maximize").click();
  await page.waitForTimeout(200);
  const restored = await soundOverlay.boundingBox();
  assert.ok(
    Math.abs(restored.x - beforeMaximize.x) <= 1 &&
      Math.abs(restored.y - beforeMaximize.y) <= 1 &&
      Math.abs(restored.width - beforeMaximize.width) <= 1 &&
      Math.abs(restored.height - beforeMaximize.height) <= 1,
    `restore should return to exactly the pre-maximise box, was ${JSON.stringify(restored)} not ${JSON.stringify(beforeMaximize)}`,
  );

  /* -------------------------------------------------- reload persistence */
  // One window minimised, another (the tree, from the starter layout) left
  // where it is — the reload has to bring both back faithfully.
  await soundGroup.getByTestId("dock-minimize").click();
  await page.locator(".soundboard").waitFor({ state: "hidden" });
  const treeOverlay = overlayByTab(page, "Channels & users");
  const treeBeforeReload = await treeOverlay.boundingBox();
  // The save is debounced; give it time to flush before reloading over it.
  await page.waitForTimeout(700);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
  await page.locator(".tree").waitFor({ state: "visible", timeout: 20_000 });
  await taskbarFor(page, "sounds").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await page.locator(".soundboard").isVisible(),
    false,
    "a window minimised before the reload comes back minimised, not visible",
  );
  const treeAfterReload = await overlayByTab(page, "Channels & users").boundingBox();
  assert.ok(
    Math.abs(treeAfterReload.x - treeBeforeReload.x) <= 2 &&
      Math.abs(treeAfterReload.y - treeBeforeReload.y) <= 2 &&
      Math.abs(treeAfterReload.width - treeBeforeReload.width) <= 2 &&
      Math.abs(treeAfterReload.height - treeBeforeReload.height) <= 2,
    `an unminimised window keeps its box across a reload, was ${JSON.stringify(treeAfterReload)} not ${JSON.stringify(treeBeforeReload)}`,
  );

  /* ------------------------------------------------------------- reset */
  await page.getByTestId("status-reset-layout").click();
  await page.locator(".tree").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    await taskbarFor(page, "sounds").count(),
    0,
    "the reset rebuilds the starter desktop, which does not include the soundboard",
  );
}
