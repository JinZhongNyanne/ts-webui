/**
 * Tearing a tab out onto the desktop: stack two windows into one frame, then
 * drag one of the tabs onto the empty desktop behind the windows. It becomes
 * its own window, where it was dropped, and the frame it left keeps the other
 * tab. Nothing docks into dockview's grid here (`dndEdges` is off), so this
 * drop target is the app's own — see `installDesktopFloatOnDrop` in
 * `apps/web/src/dock/dockWindows.ts`.
 *
 * The tab drag is native HTML5 drag-and-drop, driven the way
 * `desktop-tab-stack.spec.mjs` drives it.
 */
import assert from "node:assert/strict";

export const title = "desktop: dragging a tab onto the desktop makes it its own window";

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

const taskbarButtons = (page) => page.locator("[data-testid=taskbar-button]");

/** Every window's box, plus each desktop icon: what a drop must avoid. */
async function occupiedBoxes(page) {
  const boxes = [];
  for (const el of await page.locator(".dv-groupview, [data-testid=desktop-icon]").all()) {
    boxes.push(await el.boundingBox());
  }
  return boxes.filter(Boolean);
}

/**
 * A point on the empty desktop: no window over it, and clear of the icons.
 * Searched rather than hard-coded, so a starter layout that moves does not
 * silently turn this spec into a drop onto some other window.
 */
async function emptyDesktopPoint(page) {
  const dock = await page.locator(".dock").boundingBox();
  const busy = await occupiedBoxes(page);
  const clear = (x, y) =>
    !busy.some(
      (b) => x > b.x - 24 && x < b.x + b.width + 24 && y > b.y - 24 && y < b.y + b.height + 24,
    );
  for (let fy = 0.85; fy >= 0.35; fy -= 0.05) {
    for (let fx = 0.9; fx >= 0.3; fx -= 0.05) {
      const x = dock.x + dock.width * fx;
      const y = dock.y + dock.height * fy;
      if (clear(x, y)) return { x, y, dock };
    }
  }
  throw new Error("no empty desktop spot to drop a tab on");
}

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

export default async function desktopTabTearout(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });
  await page.locator(".dv-tab", { hasText: "Info" }).waitFor({ state: "visible" });
  await onlyWindows(page, ["Channels & users", "Info"]);

  const groupCountBefore = await page.locator(".dv-groupview").count();
  const buttonsBefore = await taskbarButtons(page).count();

  /* ------------------------------ stack them ------------------------------ */
  const treeTabBox = await page.locator(".dv-tab", { hasText: "Channels & users" }).boundingBox();
  await dragTabTo(
    page,
    page.locator(".dv-tab", { hasText: "Info" }),
    treeTabBox.x + treeTabBox.width / 2,
    treeTabBox.y + treeTabBox.height / 2,
  );
  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupCountBefore - 1,
    "stacking two windows leaves one fewer group",
  );

  /* -------------------------- and pull one back out ------------------------ */
  const spot = await emptyDesktopPoint(page);
  await dragTabTo(page, page.locator(".dv-tab", { hasText: "Info" }), spot.x, spot.y);

  assert.equal(
    await page.locator(".dv-groupview").count(),
    groupCountBefore,
    "dropping a tab on the empty desktop tears it out into its own window",
  );
  const torn = groupByTab(page, "Info");
  assert.deepEqual(
    await torn.locator(".dv-tab").allTextContents(),
    ["Info"],
    "the torn-out window holds only the tab that was dragged",
  );
  assert.deepEqual(
    await groupByTab(page, "Channels & users").locator(".dv-tab").allTextContents(),
    ["Channels & users"],
    "the window it left keeps its own tab",
  );

  /* ------------------ it landed where it was let go of -------------------- */
  const box = await torn.boundingBox();
  assert.ok(
    spot.x >= box.x - 8 &&
      spot.x <= box.x + box.width + 8 &&
      spot.y >= box.y - 8 &&
      spot.y <= box.y + box.height + 8,
    `the new window must be under the drop point: dropped at (${Math.round(spot.x)}, ${Math.round(
      spot.y,
    )}), window at ${JSON.stringify(box)}`,
  );

  /* ------------------------- and it has its button ------------------------ */
  assert.equal(
    await taskbarButtons(page).count(),
    buttonsBefore,
    "both windows still have a taskbar button of their own",
  );
  await taskbarButtons(page).filter({ hasText: "Info" }).first().waitFor({ state: "visible" });
}
