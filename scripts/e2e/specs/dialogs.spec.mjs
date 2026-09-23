/**
 * The shared dialog (AppDialog, via the poke prompt): focus lands in the
 * field, Tab stays inside, Escape closes and hands focus back, Enter submits
 * — and the poke really reaches the other client. On a phone-sized viewport
 * the same dialog is a bottom sheet.
 */
import assert from "node:assert/strict";

export const title = "dialogs: poke prompt keyboard handling, submit, mobile sheet";

/** Opens the poke prompt for `target` from `client`'s tree context menu. */
async function openPoke(rig, client, target) {
  const row = await rig.waitForClientInTree(client.page, target.nick);
  await row.click({ button: "right" });
  await client.page
    .locator(".cm-item .cm-label", { hasText: /^Poke$/ })
    .first()
    .click();
  const dialog = client.page
    .locator("[role=dialog][aria-modal=true]")
    .filter({ hasText: target.nick });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  return dialog;
}

const activeInDialog = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    return { inDialog: !!el?.closest("[role=dialog][aria-modal=true]"), tag: el?.tagName ?? "" };
  });

/**
 * `confirmDialog()` through the host mounted in App.vue. Vite serves modules
 * by path, so importing it in the page yields the app's own instance.
 */
async function checkConfirmDialog({ page }) {
  const ask = (opts) =>
    page.evaluate(async (o) => {
      const { confirmDialog } = await import("/src/components/ui/confirm.ts");
      window.__e2eAnswer = confirmDialog(o);
    }, opts);
  const answer = () => page.evaluate(() => window.__e2eAnswer);
  const focusedText = () => page.evaluate(() => document.activeElement?.textContent?.trim());
  const dialog = page.locator("[role=dialog][aria-modal=true]");

  await ask({ title: "Proceed?", message: "e2e", confirmLabel: "Do it" });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  assert.equal(await focusedText(), "Do it", "a plain confirm focuses its confirm button");
  await page.keyboard.press("Enter");
  assert.equal(await answer(), true, "Enter on the focused button confirms");

  await ask({ title: "Delete everything?", danger: true, confirmLabel: "Delete" });
  await dialog.waitFor({ state: "visible", timeout: 5_000 });
  assert.notEqual(await focusedText(), "Delete", "a destructive confirm does not pre-focus it");
  await page.keyboard.press("Escape");
  assert.equal(await answer(), false, "Escape declines");
  await dialog.waitFor({ state: "detached", timeout: 3_000 });
}

export default async function dialogs(rig) {
  const alice = await rig.connect("dlg-alice", { channel: "b" });
  const bob = await rig.connect("dlg-bob", { channel: "b" });
  const { page } = alice;

  let dialog = await openPoke(rig, alice, bob);
  assert.equal(await dialog.getAttribute("aria-modal"), "true");
  const labelledBy = await dialog.getAttribute("aria-labelledby");
  assert.ok(labelledBy, "the dialog is labelled by its title");
  assert.match(await page.locator(`[id="${labelledBy}"]`).innerText(), /Poke/);

  await page.screenshot({ path: rig.artifact("dialog-desktop.png") });

  let focus = await activeInDialog(page);
  assert.deepEqual(focus, { inDialog: true, tag: "INPUT" }, "focus starts in the field");

  // Tab past the last button wraps back inside instead of reaching the page.
  for (let i = 0; i < 5; i++) await page.keyboard.press("Tab");
  focus = await activeInDialog(page);
  assert.equal(focus.inDialog, true, "Tab stays inside the dialog");
  await page.keyboard.press("Shift+Tab");
  assert.equal((await activeInDialog(page)).inDialog, true, "Shift+Tab stays inside too");

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 3_000 });

  // A click that starts in the field and ends on the backdrop must not close it.
  dialog = await openPoke(rig, alice, bob);
  const box = await dialog.locator("input").boundingBox();
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(5, 5);
  await page.mouse.up();
  assert.equal(await dialog.isVisible(), true, "a drag out of the field keeps the dialog");
  // A real backdrop click closes it.
  await page.mouse.click(5, 5);
  await dialog.waitFor({ state: "detached", timeout: 3_000 });

  // Enter submits; the poke arrives at bob.
  dialog = await openPoke(rig, alice, bob);
  const text = `poke ${rig.runId}`;
  await dialog.locator("input").fill(text);
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "detached", timeout: 3_000 });
  await bob.page.waitForFunction(
    (t) => (window.__jinzTs?.events?.() ?? []).some((e) => e.text.includes(t)),
    text,
    { timeout: 10_000 },
  );

  await checkConfirmDialog(alice);

  // Phone width: the mobile shell takes over, and the same prompt is a bottom
  // sheet with its own close button.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator(".mshell").waitFor({ state: "visible", timeout: 10_000 });
  dialog = await openPoke(rig, alice, bob);
  assert.match((await dialog.getAttribute("class")) ?? "", /\bsheet\b/, "rendered as a sheet");
  const panelBox = await dialog.boundingBox();
  assert.ok(
    Math.abs(panelBox.y + panelBox.height - 800) < 2 && panelBox.width >= 389,
    `the sheet sits on the bottom edge at full width (got ${JSON.stringify(panelBox)})`,
  );
  await page.screenshot({ path: rig.artifact("dialog-sheet.png") });
  await dialog.locator("button.close").click();
  await dialog.waitFor({ state: "detached", timeout: 3_000 });
}
