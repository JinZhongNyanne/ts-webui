/**
 * Dropping a tab on the empty desktop puts its window AT THE DROP POINT, even
 * when that tab is the only one in its window.
 *
 * The bug this pins: a tab alone in its window was refused outright, and the
 * refusal was silent — the user dragged the tab onto the desktop, let go, and
 * absolutely nothing happened. See `desktopDropFor` in
 * `apps/web/src/dock/floatDrop.ts`. Tearing a *stacked* tab out is covered by
 * `desktop-tab-tearout.spec.mjs`; this one covers the lone tab, which moves
 * its window instead of rebuilding it.
 *
 * The tab drag is native HTML5 drag-and-drop, driven the way
 * `desktop-tab-stack.spec.mjs` drives it.
 */
import assert from "node:assert/strict";

export const title = "desktop: a lone tab dropped on the desktop moves its window there";

/** Drags a `.dv-tab` to a point by its native HTML5 drag-and-drop. */
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

/** How far above the cursor the window's top edge lands; `FLOAT_GRAB_OFFSET`. */
const GRAB_OFFSET = 16;

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

export default async function desktopTabDropDesktop(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  await page.locator(".dv-tab", { hasText: "Info" }).waitFor({ state: "visible" });
  const dock = await page.locator(".dock").boundingBox();

  // Put every other window away, so the desktop behind Info is genuinely empty
  // and the drop cannot land on some other window's content instead.
  await onlyWindows(page, ["Info"]);

  const info = groupByTab(page, "Info");
  const before = await info.boundingBox();
  const groupsBefore = await page.locator(".dv-groupview").count();
  assert.deepEqual(
    await info.locator(".dv-tab").allTextContents(),
    ["Info"],
    "this spec needs the Info tab to be alone in its window",
  );

  const spot = { x: dock.x + dock.width * 0.3, y: dock.y + dock.height * 0.3 };
  await dragTabTo(page, page.locator(".dv-tab", { hasText: "Info" }), spot.x, spot.y);

  const after = await info.boundingBox();
  assert.notDeepEqual(
    { x: after.x, y: after.y },
    { x: before.x, y: before.y },
    "dropping a tab on the desktop must do something: the window did not move at all",
  );
  assert.ok(
    Math.abs(after.x + after.width / 2 - spot.x) <= 6,
    `the window is centred on the drop point: dropped at x=${Math.round(spot.x)}, window ${JSON.stringify(after)}`,
  );
  assert.ok(
    Math.abs(after.y - (spot.y - GRAB_OFFSET)) <= 6,
    `the window's tab bar lands under the pointer: dropped at y=${Math.round(spot.y)}, window ${JSON.stringify(after)}`,
  );
  assert.ok(
    Math.abs(after.width - before.width) <= 2 && Math.abs(after.height - before.height) <= 2,
    `moving a window keeps its size, was ${before.width}x${before.height}, now ${after.width}x${after.height}`,
  );
  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupsBefore,
    "the window moved rather than being torn down and rebuilt",
  );
}
