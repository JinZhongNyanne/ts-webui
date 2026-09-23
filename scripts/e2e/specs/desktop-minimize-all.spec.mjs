/**
 * The taskbar's "minimise all", which Windows pins at the right-hand end of
 * its taskbar: one press clears the desktop, the next puts back what that
 * press put away — and nothing the user had put away themselves.
 */
import assert from "node:assert/strict";

export const title = "desktop: minimise all clears the desktop and puts back what it cleared";

const taskbarButtons = (page) => page.locator("[data-testid=taskbar-button]");

export default async function desktopMinimizeAll(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;

  await page.locator(".tree").waitFor({ state: "visible" });
  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor({ state: "visible" });
  const openWindows = await taskbarButtons(page).count();
  assert.ok(openWindows >= 2, `expected at least two open windows, had ${openWindows}`);

  // It sits outside the scrolling list of window buttons, so it is reachable
  // however many windows are open.
  const minimizeAll = page.getByTestId("taskbar-minimize-all");
  await minimizeAll.waitFor({ state: "visible" });

  /* ------------------------------------------------------- one press away */
  await minimizeAll.click();
  await page.locator(".soundboard").waitFor({ state: "hidden" });
  await page.locator(".tree").waitFor({ state: "hidden" });
  assert.equal(
    await taskbarButtons(page).count(),
    openWindows,
    "minimising every window must keep every taskbar button — the windows are away, not closed",
  );

  /* ------------------------------------------------------ and one back */
  await minimizeAll.click();
  await page.locator(".soundboard").waitFor({ state: "visible" });
  await page.locator(".tree").waitFor({ state: "visible" });

  /* ------------- a window the user minimised themselves stays minimised */
  // A window is found by its TAB, not by its content: `default-renderer="always"`
  // renders panel content into a shared overlay beside the frames, so the
  // content is no longer a descendant of its own `.dv-groupview`.
  const soundboard = page.locator(".dv-groupview", {
    has: page.locator(".dv-tab", { hasText: "Soundboard" }),
  });
  await soundboard.getByTestId("dock-minimize").click();
  await page.locator(".soundboard").waitFor({ state: "hidden" });

  await minimizeAll.click();
  await page.locator(".tree").waitFor({ state: "hidden" });
  await minimizeAll.click();
  await page.locator(".tree").waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".soundboard").isVisible(),
    false,
    "minimise all must not reopen a window the user had put away themselves",
  );
}
