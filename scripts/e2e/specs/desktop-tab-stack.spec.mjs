/**
 * Dropping one window's tab onto another window's tab bar stacks them into
 * one frame; dropping a tab on a window's content centre tears it back out.
 * With nothing able to dock into the grid, centre-drop is the only way to
 * un-stack a tab, so it is worth pinning (see `installFloatOnDrop` in
 * `apps/web/src/dock/dockWindows.ts`).
 *
 * This uses two starter windows (the channel tree and Info) that never
 * overlap at this viewport size, so no window has to be dragged into place
 * first — only their tabs move, over native HTML5 drag-and-drop, which held
 * up fine across repeats while writing this suite. See desktop-snap-corner
 * .spec.mjs for the *floating-window move* drag that does not.
 */
import assert from "node:assert/strict";

export const title = "desktop: dropping a tab stacks windows, dropping on content tears one out";

/**
 * Drags a `.dv-tab` to a point by its native HTML5 drag-and-drop (dockview
 * does not use pointer events for tabs, only for the floating-window move
 * handle). A handful of small steps right after mousedown is what gets
 * Chromium to recognise the gesture as a drag rather than a click.
 */
async function dragTabTo(page, tab, x, y) {
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
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

const groupByTab = (page, tabText) =>
  page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: tabText }) });

/**
 * Leaves only the named windows on the desktop.
 *
 * The starter desktop tiles the whole screen, and the app opens windows of its
 * own shortly after connecting (Music, the channel's chat) on top of it — one
 * of which lies right over the Info tab this spec grabs. So everything is put
 * away with the taskbar's "minimise all" and only what the spec drags is
 * brought back, after giving those windows time to appear.
 */
async function onlyWindows(page, titles) {
  await page.waitForTimeout(AUTO_WINDOWS_MS);
  await page.getByTestId("taskbar-minimize-all").click();
  for (const text of titles) {
    await page.locator("[data-testid=taskbar-button]").filter({ hasText: text }).first().click();
  }
  await page.waitForTimeout(200);
}

/** How long after connecting the app has opened the windows it opens by itself. */
const AUTO_WINDOWS_MS = 1_500;

export default async function desktopTabStack(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  const infoTabReady = page.locator(".dv-tab", { hasText: "Info" });
  await infoTabReady.waitFor({ state: "visible" });
  await onlyWindows(page, ["Channels & users", "Info"]);

  const groupCountBefore = await page.locator(".dv-groupview").count();

  const treeTab = page.locator(".dv-tab", { hasText: "Channels & users" });
  const infoTab = page.locator(".dv-tab", { hasText: "Info" });
  const treeTabBox = await treeTab.boundingBox();
  await dragTabTo(
    page,
    infoTab,
    treeTabBox.x + treeTabBox.width / 2,
    treeTabBox.y + treeTabBox.height / 2,
  );

  const stackedGroup = groupByTab(page, "Channels & users");
  assert.deepEqual(
    (await stackedGroup.locator(".dv-tab").allTextContents()).sort(),
    ["Channels & users", "Info"].sort(),
    "dropping a tab on another window's tab bar stacks them in one frame",
  );
  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupCountBefore - 1,
    "stacking two windows leaves one fewer group",
  );

  const content = stackedGroup.locator(".dv-content-container");
  const contentBox = await content.boundingBox();
  await dragTabTo(
    page,
    page.locator(".dv-tab", { hasText: "Info" }),
    contentBox.x + contentBox.width / 2,
    contentBox.y + contentBox.height / 2,
  );
  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupCountBefore,
    "dropping a tab on a window's content centre tears it back out",
  );
  assert.equal(
    await groupByTab(page, "Channels & users").locator(".dv-tab").count(),
    1,
    "the torn-out window has only its own tab again",
  );
}
