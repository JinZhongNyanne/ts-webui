/**
 * Resizing the browser keeps every window where it was relative to the
 * desktop: a maximised window still fills it, and a window flush against the
 * right and bottom edges is still flush against them.
 */
import assert from "node:assert/strict";

export const title = "desktop: resizing the browser keeps windows in place relative to the desktop";

const overlayByTab = (page, tabText) =>
  page.locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) });

/** Every window's box, relative to the desktop, keyed by its first tab. */
async function boxes(page) {
  return page.evaluate(() => {
    const dock = document.querySelector(".dock").getBoundingClientRect();
    const out = { dock: [Math.round(dock.width), Math.round(dock.height)] };
    for (const el of document.querySelectorAll(".dock .dv-resize-container")) {
      const r = el.getBoundingClientRect();
      const tab = el.querySelector(".dv-tab")?.textContent?.trim() ?? "?";
      out[tab] = [r.left - dock.left, r.top - dock.top, r.width, r.height].map(Math.round);
    }
    return out;
  });
}

export default async function desktopResizeRefit(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });

  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor({ state: "visible" });
  const soundGroup = page.locator(".dv-groupview", {
    has: page.locator(".dv-tab", { hasText: "Soundboard" }),
  });
  await soundGroup.getByTestId("dock-maximize").click();
  await page.waitForTimeout(300);

  const before = await boxes(page);
  console.log("      before", JSON.stringify(before));
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: viewport.width + 300, height: viewport.height + 150 });
  await page.waitForTimeout(600);
  const grown = await boxes(page);
  console.log("      grown ", JSON.stringify(grown));
  await page.setViewportSize({ width: viewport.width - 200, height: viewport.height - 100 });
  await page.waitForTimeout(600);
  const shrunk = await boxes(page);
  console.log("      shrunk", JSON.stringify(shrunk));

  for (const [label, now] of [
    ["grown", grown],
    ["shrunk", shrunk],
  ]) {
    assert.deepEqual(
      now.Soundboard,
      [0, 0, now.dock[0], now.dock[1]],
      `${label}: the maximised window fills the desktop`,
    );
    const tabs = Object.keys(before).filter((t) => t !== "dock" && t !== "Soundboard" && now[t]);
    for (const tab of tabs) {
      const [x, y, w, h] = before[tab];
      const [nx, ny, nw, nh] = now[tab];
      if (x + w === before.dock[0])
        assert.equal(nx + nw, now.dock[0], `${label}: ${tab} stays flush right`);
      if (y + h === before.dock[1])
        assert.equal(ny + nh, now.dock[1], `${label}: ${tab} stays flush bottom`);
      if (x === 0) assert.equal(nx, 0, `${label}: ${tab} stays flush left`);
      if (y === 0) assert.equal(ny, 0, `${label}: ${tab} stays flush top`);
      // A seam — this window's right or bottom edge on a neighbour's left or
      // top — is still a seam: no gap opens between tiled windows.
      for (const other of tabs) {
        const [ox, oy, ow, oh] = before[other];
        const [nox, noy] = now[other];
        const sideBySide = x + w === ox && y < oy + oh && oy < y + h;
        const stacked = y + h === oy && x < ox + ow && ox < x + w;
        if (sideBySide) assert.equal(nx + nw, nox, `${label}: ${tab} still meets ${other}`);
        if (stacked) assert.equal(ny + nh, noy, `${label}: ${tab} still meets ${other} below`);
      }
    }
  }
}
