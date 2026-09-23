/**
 * The desktop shell: a window opens from its icon, lives in the taskbar, and
 * minimises, restores and snaps the way a Windows window does.
 */
import assert from "node:assert/strict";

export const title = "desktop: icons open windows, the taskbar tracks them, edges snap";

const taskbarFor = (page, panelId) =>
  page.locator(`[data-testid=taskbar-button][data-panel="${panelId}"]`);

/**
 * Moves the channel tree's window out of the way of the desktop icons, runs
 * `open`, and brings the tree back.
 *
 * The starter desktop tiles the whole screen, so the icon column lies under
 * the tree's window and a click on an icon lands on the tree instead. A user
 * moves the window aside; the spec minimises it and restores it from the
 * taskbar, which leaves it exactly where it was.
 */
async function besideTheTree(page, open) {
  const tree = page.locator(".dv-groupview", {
    has: page.locator(".dv-tab", { hasText: "Channels & users" }),
  });
  await tree.getByTestId("dock-minimize").click();
  await page.locator(".tree").waitFor({ state: "hidden" });
  await open();
  await page.locator('[data-testid=taskbar-button][data-panel="tree"]').click();
  await page.locator(".tree").waitFor({ state: "visible" });
}

export default async function desktop(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;

  // The starter desktop is up: the tree is a window, and it has a taskbar button.
  await page.locator(".tree").waitFor({ state: "visible" });
  await taskbarFor(page, "tree").waitFor({ state: "visible" });

  // The taskbar's two snap switches start the way `snapMode.ts` sets them:
  // window-to-window snapping on, screen-edge snapping off — resizing a window
  // to half the screen is asked for, not assumed.
  const edgeSnap = page.locator("[data-testid=taskbar-snap-edges]");
  const windowSnap = page.locator("[data-testid=taskbar-snap-windows]");
  await edgeSnap.waitFor({ state: "visible" });
  await windowSnap.waitFor({ state: "visible" });
  assert.equal(await edgeSnap.getAttribute("aria-checked"), "false", "edge snapping starts off");
  assert.equal(await windowSnap.getAttribute("aria-checked"), "true", "window snapping starts on");

  // A window the starter desktop does not open has an icon but no button.
  assert.equal(await taskbarFor(page, "sounds").count(), 0, "soundboard starts closed");
  // ONE click opens it — there is no select-then-double-click step any more.
  // `rig.openFromDesktop` does exactly this (and clears the desktop for it by
  // itself); it is spelled out here so the gesture itself is what the suite pins.
  const soundsIcon = page.locator("[data-testid=desktop-icon][data-window=sounds]");
  await soundsIcon.waitFor({ state: "visible", timeout: 15_000 });
  await besideTheTree(page, () => soundsIcon.click());
  await page.locator(".soundboard").waitFor({ state: "visible" });
  await taskbarFor(page, "sounds").waitFor({ state: "visible" });

  // Minimise: the window goes, the button stays.
  // A window is found by its TAB, not by its content: `default-renderer="always"`
  // renders panel content into a shared overlay beside the frames, so the
  // content is no longer a descendant of its own `.dv-groupview`.
  const soundboardTab = page.locator(".dv-tab", { hasText: "Soundboard" });
  const soundboard = page.locator(".dv-groupview", { has: soundboardTab });
  await soundboard.getByTestId("dock-minimize").click();
  await page.locator(".soundboard").waitFor({ state: "hidden" });
  await taskbarFor(page, "sounds").waitFor({ state: "visible" });

  // ...and so does its close "X". dockview's own stylesheet puts
  // `visibility: visible` on the ACTIVE tab's close action, and `visibility`
  // is inherited — so that descendant rule defeated the window's
  // `visibility: hidden` and left a stray cross painted on an empty desktop.
  // Playwright calls such an element visible too, which is why the bug got
  // past this suite once already; the check is therefore what the screen
  // really shows — the button's painted opacity, every ancestor multiplied in.
  const closeAction = page
    .locator(".dv-resize-container", { has: soundboardTab })
    .locator(".dv-default-tab-action")
    .first();
  await closeAction.waitFor({ state: "attached" });
  const painted = await closeAction.evaluate((el) => {
    let opacity = 1;
    for (let node = el; node instanceof Element; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    return opacity;
  });
  assert.equal(painted, 0, "a minimised window's close X must not paint");
  assert.ok(
    await closeAction.evaluate((el) => !!el.closest("[inert]")),
    "a minimised window must be beyond reach of the pointer and of keyboard focus",
  );

  // And so does its CONTENT, which with `default-renderer="always"` is not
  // inside the frame at all: dockview renders it into a shared overlay on the
  // dock's shell, so hiding the frame alone would leave a minimised window's
  // contents floating on the empty desktop. Measured the same way — the paint
  // the screen really gets — because dockview writes `visibility` inline on
  // that overlay and would win over any class.
  const contentPaint = await page.locator(".soundboard").evaluate((el) => {
    let opacity = 1;
    for (let node = el; node instanceof Element; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    return opacity;
  });
  assert.equal(contentPaint, 0, "a minimised window's contents must not paint either");
  assert.ok(
    await page.locator(".soundboard").evaluate((el) => !!el.closest("[inert]")),
    "a minimised window's contents must be beyond reach of pointer and keyboard",
  );

  // The taskbar button brings it back.
  await taskbarFor(page, "sounds").click();
  await page.locator(".soundboard").waitFor({ state: "visible" });

  // Snap it to the left half by dragging its tab bar to the left edge, which
  // first has to be switched on.
  await edgeSnap.click();
  assert.equal(await edgeSnap.getAttribute("aria-checked"), "true", "the edge switch flips on");
  //
  // The app sets `floating-group-drag-handle="tabbar"`, so the drag handle is
  // `.dv-void-container`: the empty space of the group's own tab bar. Dragging
  // a tab (`.dv-tab`) instead would reorder or tear out that tab, so the void
  // is grabbed by name — there is deliberately no fallback, because a fallback
  // that silently drags the wrong thing is what let this bug hide through a
  // live run. The window's real box is still the overlay
  // (`.dv-resize-container`) that WRAPS the group, which is what the snap is
  // measured against below.
  const dock = await page.locator(".dock").boundingBox();
  const overlay = page.locator(".dv-resize-container", { has: soundboardTab });
  const handle = await overlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // dockview tracks the window by the offset between the pointer and the
  // overlay's corner at the first move after mousedown, so that offset has to
  // be captured near the grab point — a single large jump straight to the
  // target would record the offset from wherever the jump's first step lands
  // instead, and the window would end up short of the edge by that error.
  await page.mouse.move(grabX + 1, grabY);
  // Snapping is armed by where the CURSOR is, as in Windows 11 — not by where
  // the dragged window's edges land — so the pointer itself goes to the left
  // edge, at mid-height so it is clear of the corner regions that would arm a
  // quarter instead of the left half.
  await page.mouse.move(dock.x + 4, dock.y + dock.height / 2, { steps: 20 });
  await page.locator("[data-testid=snap-preview]").waitFor({ state: "visible" });
  await page.mouse.up();
  // The group is inset within the overlay by its borders, so the
  // overlay (the window's real box) is what a left-half snap actually sizes.
  // `snapBox()` (apps/web/src/dock/snap.ts) gives the left half as exactly
  // `Math.floor(desktop.width / 2)` — an integer pixel value with no margin —
  // so a couple of pixels covers sub-pixel layout rounding and nothing else.
  const snapped = await overlay.boundingBox();
  assert.ok(
    Math.abs(snapped.width - Math.floor(dock.width / 2)) <= 2,
    `snapped window should take exactly half the desktop, took ${snapped.width} of ${dock.width}`,
  );

  // Double-click the tab bar to maximise, and again to put the window back —
  // the same transition the maximise button performs, so the box it comes back
  // to is the half it was snapped to just above. The void space is what is
  // double-clicked, not a tab: a tab carries its own close cross, which must
  // stay a close cross under two quick clicks.
  const voidSpace = overlay.locator(".dv-void-container").first();
  await voidSpace.dblclick();
  const filled = await overlay.boundingBox();
  assert.ok(
    Math.abs(filled.width - dock.width) <= 2 && Math.abs(filled.height - dock.height) <= 2,
    `a double-clicked tab bar should maximise, filled ${filled.width}x${filled.height} of ` +
      `${dock.width}x${dock.height}`,
  );
  // And the window's own control now offers to restore rather than to maximise,
  // which is the state — not just the size — having changed.
  assert.equal(
    (await soundboard.getByTestId("dock-maximize").textContent()).trim(),
    "❐",
    "a maximised window's middle control must show the restore mark",
  );
  await voidSpace.dblclick();
  const restored = await overlay.boundingBox();
  assert.ok(
    Math.abs(restored.width - snapped.width) <= 2,
    `a second double-click should restore the box it had, got ${restored.width} ` +
      `instead of ${snapped.width}`,
  );

  // The two switches are independent of each other: flipping one never moves
  // the other. Both end as they started the spec.
  await windowSnap.click();
  assert.equal(
    await windowSnap.getAttribute("aria-checked"),
    "false",
    "the window switch flips off",
  );
  assert.equal(
    await edgeSnap.getAttribute("aria-checked"),
    "true",
    "and leaves the edge switch alone",
  );
  await edgeSnap.click();
  assert.equal(await edgeSnap.getAttribute("aria-checked"), "false", "the edge switch flips off");
  await windowSnap.click();
  assert.equal(
    await windowSnap.getAttribute("aria-checked"),
    "true",
    "and the window switch back on",
  );
  assert.equal(await edgeSnap.getAttribute("aria-checked"), "false", "leaving the edge switch off");

  // Closing it takes its button away; the icon is still there to reopen it.
  await soundboard.getByTestId("dock-close-group").click();
  await page.locator(".soundboard").waitFor({ state: "detached" });
  assert.equal(await taskbarFor(page, "sounds").count(), 0, "a closed window leaves the taskbar");
  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor({ state: "visible" });
}
