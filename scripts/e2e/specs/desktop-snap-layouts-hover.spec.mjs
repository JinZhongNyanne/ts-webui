/**
 * Snap Layouts, trigger one: resting the pointer on a window's maximise button
 * opens the flyout, and picking one of its regions puts the window there.
 *
 * No window is dragged here, so — unlike the snap specs — this one is free to
 * check the whole flyout in a single page session.
 */
import assert from "node:assert/strict";

export const title = "desktop: hovering maximise opens Snap Layouts, and a tile snaps the window";

/** The floating overlay that actually carries a window's box; see desktop.spec.mjs. */
const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

/** The tile for one region of one layout. */
const tileFor = (page, layout, zone) =>
  page.locator(`[data-testid=snap-layout-zone][data-layout="${layout}"][data-zone="${zone}"]`);

export default async function desktopSnapLayoutsHover(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });

  const dock = await page.locator(".dock").boundingBox();
  // A window is found by its TAB, not by its content: `default-renderer="always"`
  // renders panel content into a shared overlay beside the frames, so the
  // content is no longer a descendant of its own `.dv-groupview`.
  const treeGroup = page.locator(".dv-groupview", {
    has: page.locator(".dv-tab", { hasText: "Channels & users" }),
  });
  const treeOverlay = overlayByTab(page, "Channels & users");
  const panel = page.locator("[data-testid=snap-layouts]");
  const maximize = treeGroup.getByTestId("dock-maximize");

  /* -------------------------------------------------------- it opens */
  await maximize.hover();
  await panel.waitFor({ state: "visible", timeout: 5_000 });

  const panelBox = await panel.boundingBox();
  assert.ok(
    panelBox.x >= dock.x - 1 && panelBox.x + panelBox.width <= dock.x + dock.width + 1,
    `the flyout stays inside the desktop, was at ${panelBox.x}..${panelBox.x + panelBox.width} of ${dock.x}..${dock.x + dock.width}`,
  );

  /* ------------------------------------------- it shows the five layouts */
  const layouts = await page
    .locator("[data-testid=snap-layouts] .snap-layout")
    .evaluateAll((nodes) =>
      nodes.map((n) => n.querySelector("[data-layout]")?.getAttribute("data-layout")),
    );
  assert.deepEqual(
    layouts,
    ["even", "wide-left", "wide-right", "left-stack", "quarters"],
    "the five Windows 11 layouts, left to right",
  );
  assert.equal(
    await page.locator("[data-testid=snap-layout-zone]").count(),
    2 + 2 + 2 + 3 + 4,
    "every region of every layout is its own tile",
  );

  /* ------------------------------------------------------ Escape closes */
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden", timeout: 5_000 });

  /* ----------------------------------------------- a tile snaps the window */
  // Away and back: the flyout opens on the pointer *entering* the button, so
  // it has to leave it first for the second hover to be a hover at all.
  await page.mouse.move(dock.x + dock.width / 2, dock.y + dock.height - 20);
  await maximize.hover();
  await panel.waitFor({ state: "visible", timeout: 5_000 });

  await tileFor(page, "wide-left", "right").click();
  await panel.waitFor({ state: "hidden", timeout: 5_000 });
  await page.waitForTimeout(300);

  // The narrow right column of the wide-left layout: the desktop's last third,
  // rounded the way apps/web/src/dock/layouts.ts rounds it.
  const split = Math.floor((2 * dock.width) / 3);
  const snapped = await treeOverlay.boundingBox();
  assert.ok(
    Math.abs(snapped.x - (dock.x + split)) <= 2 &&
      Math.abs(snapped.y - dock.y) <= 2 &&
      Math.abs(snapped.width - (dock.width - split)) <= 2 &&
      Math.abs(snapped.height - dock.height) <= 2,
    `picking the narrow right column should give ${dock.width - split}x${dock.height} at (${dock.x + split},${dock.y}), got ${JSON.stringify(snapped)}`,
  );
}
