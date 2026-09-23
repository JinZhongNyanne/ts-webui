/**
 * A window dragged at the edge of the desktop must never make the PAGE scroll.
 *
 * dockview lets a floating group hang outside its container, and nothing above
 * it clipped the overflow, so the document grew and the browser put scrollbars
 * on the whole app — the desktop slid away under the taskbar and status bar.
 *
 * The drag holds Alt, which is the modifier that suspends Aero Snap (see
 * `snapZoneFor` in apps/web/src/dock/snap.ts): a snapped window is re-boxed
 * inside the desktop on drop and would hide the overflow this checks for.
 *
 * One window-move drag per page load, like the other drag specs; see
 * desktop-snap-corner.spec.mjs for why.
 */
import assert from "node:assert/strict";

export const title = "desktop: a window dragged past the edge never scrolls the page";

/** The floating overlay that actually carries a window's box; see desktop.spec.mjs. */
const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

/** What the document says about its own scrollable area, after trying to scroll it. */
const pageScroll = (page) =>
  page.evaluate(() => {
    window.scrollTo(10_000, 10_000);
    const el = document.documentElement;
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    };
  });

export default async function desktopNoPageScroll(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  const overlay = overlayByTab(page, "Video");
  await overlay.waitFor({ state: "visible" });

  const dock = await page.locator(".dock").boundingBox();
  const handle = await overlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;

  // Alt suspends snapping, so the window is dropped exactly where it is dragged.
  await page.keyboard.down("Alt");
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // dockview captures the pointer-to-corner offset on the first move after
  // mousedown, so that move has to stay next to the grab point; see desktop.spec.mjs.
  await page.mouse.move(grabX + 1, grabY);
  // Hard into the bottom-right corner: the window hangs off both edges at once.
  await page.mouse.move(dock.x + dock.width - 8, dock.y + dock.height - 8, { steps: 20 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.waitForTimeout(300);

  const after = await pageScroll(page);
  assert.ok(
    after.scrollWidth <= after.clientWidth,
    `the page must not scroll sideways: scrollWidth ${after.scrollWidth} > clientWidth ${after.clientWidth}`,
  );
  assert.ok(
    after.scrollHeight <= after.clientHeight,
    `the page must not scroll down: scrollHeight ${after.scrollHeight} > clientHeight ${after.clientHeight}`,
  );
  assert.equal(after.scrollX, 0, "the page must not have scrolled sideways");
  assert.equal(after.scrollY, 0, "the page must not have scrolled down");

  // And the window itself stays on the desktop, not off the side of it.
  const moved = await overlay.boundingBox();
  assert.ok(
    moved.x >= dock.x - 2 &&
      moved.y >= dock.y - 2 &&
      moved.x + moved.width <= dock.x + dock.width + 2 &&
      moved.y + moved.height <= dock.y + dock.height + 2,
    `the window should stay inside the desktop, sat at (${moved.x},${moved.y}) ${moved.width}x${moved.height} in ${dock.width}x${dock.height} at (${dock.x},${dock.y})`,
  );
}
