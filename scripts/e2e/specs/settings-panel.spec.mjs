/**
 * The settings panel: the status bar keeps only in-call controls, and every
 * rarely used setting is one gear click away, in one dialog with tabs.
 */
import assert from "node:assert/strict";

export const title =
  "settings panel: the gear opens every setting, the bar keeps only call controls";

export default async function settingsPanel(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const { page } = alice;
  const bar = page.locator("footer.bar");

  // The popovers that used to crowd the bar are gone from it.
  for (const icon of ["🎨", "🌐", "🗣️", "🔔", "💬", "🖥️", "🎥"]) {
    assert.equal(
      await bar.locator("button", { hasText: icon }).count(),
      0,
      `the status bar no longer carries ${icon}`,
    );
  }
  assert.ok(await page.getByTestId("status-away").isVisible(), "away stays in the bar");

  await page.getByTestId("status-settings").click();
  const panel = page.locator(".dialog-panel");
  await panel.waitFor();
  const tabs = await panel.locator("[role=tab]").count();
  assert.ok(tabs >= 9, `the panel lists every settings page (${tabs})`);

  // Each tab shows its own pane; a few with a recognisable control.
  await panel.getByTestId("settings-tab-theme").click();
  await panel.locator(".presets").waitFor();
  await panel.getByTestId("settings-tab-mic").click();
  await panel.locator("select").first().waitFor();
  await panel.getByTestId("settings-tab-language").click();
  await panel.locator("[role=radio]").first().waitFor();

  // Advanced: the log is a switch here now.
  await panel.getByTestId("settings-tab-advanced").click();
  await panel.getByTestId("settings-show-log").check();
  await page.locator(".log-float").waitFor();
  await panel.getByTestId("settings-show-log").uncheck();
  await page.locator(".log-float").waitFor({ state: "detached" });

  // Escape closes it; the gear reopens it where it was left.
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
  await page.getByTestId("status-settings").click();
  assert.equal(
    await panel.getByTestId("settings-tab-advanced").getAttribute("aria-selected"),
    "true",
    "the panel reopens on the last tab",
  );

  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });

  // The layout reset stays in the bar and brings back the starter desktop.
  await page.getByTestId("status-reset-layout").click();
  await page.locator(".tree").waitFor({ state: "visible", timeout: 10_000 });
  await page
    .locator("[data-testid=taskbar-button]")
    .first()
    .waitFor({ state: "visible", timeout: 10_000 });
}
