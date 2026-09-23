/**
 * Dropping a tab on a window's EDGE splits that window: the tab becomes a
 * window filling half of it, and the window underneath shrinks into the other
 * half, so the two sit side by side rather than overlapping. See
 * `apps/web/src/dock/tabSplit.ts` and `useTabDrop.ts`.
 *
 * Two things this spec exists to pin down, because neither is visible from a
 * unit test:
 *
 * - The split is DWELL-gated. The drag has to rest on the edge for half a
 *   second (`DWELL_MS`), which is exactly why `desktop-tab-tearout.spec.mjs` —
 *   which releases after 250ms — still tears out instead of splitting.
 * - The window underneath really is resized, not merely covered.
 *
 * The tab drag is native HTML5 drag-and-drop, driven the way
 * `desktop-tab-tearout.spec.mjs` drives it.
 */
import assert from "node:assert/strict";

export const title = "desktop: dropping a tab on a window's edge splits that window";

/** Longer than the dwell in `snapDwell.ts`, with room for a slow machine. */
const DWELL_HOLD_MS = 900;

/** Drags a `.dv-tab` to a point and holds it there before letting go. */
async function dragTabTo(page, tab, x, y, holdMs) {
  const box = await tab.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // A native drag only starts once the pointer has moved a few pixels.
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX + i * 2, startY + i, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.move(x, y, { steps: 20 });
  // Playwright's drag emulation hands the page the `dragover` for a move only
  // with the NEXT input event, so one pixel more is what reports the drag as
  // being where it was taken. Held still after that, it repeats nothing — a
  // real Chromium fires `dragover` every 50ms or so — and it is `useTabDrop`'s
  // own timer that serves the dwell.
  await page.mouse.move(x, y + 1);
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

const groupByTab = (page, tabText) =>
  page.locator(".dv-groupview", { has: page.locator(".dv-tab", { hasText: tabText }) });

/**
 * A point in the left band of `target` that no other window covers.
 *
 * dockview's content quadrant is the outer 20% of the content box, so the band
 * is searched at 10% across; the vertical scan is what keeps a starter layout
 * whose windows overlap from turning this into a drop on the wrong window.
 */
async function leftEdgePoint(page, target, avoid) {
  const box = await target.boundingBox();
  const busy = (await Promise.all(avoid.map((el) => el.boundingBox()))).filter(Boolean);
  const x = box.x + box.width * 0.1;
  for (let fy = 0.5; fy <= 0.92; fy += 0.04) {
    const y = box.y + box.height * fy;
    const covered = busy.some(
      (b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height,
    );
    if (!covered) return { x, y, box };
  }
  throw new Error("no uncovered point on the target window's left edge");
}

/** Whether two numbers agree to within the rounding a half split allows. */
const near = (a, b, slack = 4) => Math.abs(a - b) <= slack;

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

export default async function desktopTabSplit(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  await page.locator(".dv-tab", { hasText: "Info" }).waitFor({ state: "visible" });
  // Split the wide Video window: since the starter desktop tiles the screen, the
  // channel tree is too narrow to halve into two usable windows, and a split
  // that would leave either half below `MIN_WINDOW_EXTENT` is refused.
  await onlyWindows(page, ["Video", "Info"]);

  const groupCountBefore = await page.locator(".dv-groupview").count();
  const under = groupByTab(page, "Video");
  const dragged = page.locator(".dv-tab", { hasText: "Info" });
  const spot = await leftEdgePoint(page, under, [groupByTab(page, "Info")]);
  const before = spot.box;

  await dragTabTo(page, dragged, spot.x, spot.y, DWELL_HOLD_MS);

  /* --------------------- the tab took the left half ----------------------- */
  const tabWindow = groupByTab(page, "Info");
  const tabBox = await tabWindow.boundingBox();
  const underBox = await under.boundingBox();

  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupCountBefore,
    "a split leaves the same number of windows: nothing was stacked",
  );
  assert.ok(
    near(tabBox.x, before.x) && near(tabBox.width, Math.floor(before.width / 2), 6),
    `the tab must fill the left half of ${JSON.stringify(before)}: got ${JSON.stringify(tabBox)}`,
  );

  /* ------------- and the window underneath gave that space up ------------- */
  assert.ok(
    near(underBox.x, before.x + Math.floor(before.width / 2), 6),
    `the window underneath must start at the split line: got ${JSON.stringify(underBox)}`,
  );
  assert.ok(
    near(underBox.width, before.width - Math.floor(before.width / 2), 6),
    "the window underneath keeps the other half",
  );
  assert.ok(
    near(tabBox.x + tabBox.width, underBox.x, 6),
    "the two halves meet with no seam and no overlap",
  );
  assert.ok(
    near(tabBox.height, before.height, 6) && near(underBox.height, before.height, 6),
    "a left split changes neither window's height",
  );
}
