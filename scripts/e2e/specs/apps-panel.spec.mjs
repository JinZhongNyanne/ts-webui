/**
 * The Apps window: the website list is the hub's and shared by everyone on
 * it; which sites are open is each user's own.
 */
import assert from "node:assert/strict";
import { until } from "../lib/rig.mjs";

export const title = "apps panel: a site added by one user shows up for another, removal too";

async function openApps(page, rig) {
  await rig.openFromDesktop(page, "apps");
  await page.locator(".apps").waitFor();
}

const entries = (page) => page.locator(".apps [data-testid=apps-entry]");
const tabs = (page) => page.locator(".apps [data-testid=apps-tab]");

export default async function appsPanel(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const bob = await rig.connect("bob", { channel: "b" });
  await openApps(alice.page, rig);
  await openApps(bob.page, rig);

  // The page's own origin is refused: a framed copy could reach our storage.
  const a = alice.page;
  await a.getByTestId("apps-url").fill(new URL(a.url()).origin);
  await a.getByTestId("apps-save").click();
  await a.locator(".apps .error").waitFor();
  assert.equal(await entries(a).count(), 0, "nothing is added for our own origin");

  // Another origin works. (localhost, not 127.0.0.1: the hub is reached as
  // 127.0.0.1 and treats that origin as its own.)
  const site = `${rig.hubUrl.replace("127.0.0.1", "localhost")}/api/health`;
  await a.getByTestId("apps-url").fill(site);
  await a.getByTestId("apps-name").fill("Health");
  await a.getByTestId("apps-save").click();
  const frame = a.locator(".apps iframe");
  await frame.waitFor();
  assert.equal(await frame.getAttribute("src"), site);
  assert.equal(await tabs(a).count(), 1, "alice has it open");

  // Bob sees it in the shared list without reloading, but has nothing open.
  await until(async () => (await entries(bob.page).count()) === 1, "bob sees alice's site");
  assert.match(await entries(bob.page).first().innerText(), /Health/);
  assert.equal(await tabs(bob.page).count(), 0, "opening is per user");
  await entries(bob.page).first().click();
  await bob.page.locator(".apps iframe").waitFor();
  assert.equal(await tabs(bob.page).count(), 1);

  // Zoom is per site and per user: the frame is laid out wider and scaled down.
  await bob.page.getByTestId("apps-zoom-out").click();
  await bob.page.getByTestId("apps-zoom-out").click();
  assert.equal((await bob.page.getByTestId("apps-zoom-level").innerText()).trim(), "80%");
  const bobFrame = bob.page.locator(".apps iframe");
  assert.match((await bobFrame.getAttribute("style")) ?? "", /scale\(0\.8\)/);
  const panelWidth = (await bob.page.locator(".apps .frames").boundingBox()).width;
  const frameWidth = (await bobFrame.boundingBox()).width;
  assert.ok(Math.abs(frameWidth - panelWidth) < 2, "the scaled frame still fills the panel");
  assert.equal(
    await a
      .getByTestId("apps-zoom-level")
      .innerText()
      .then((t) => t.trim()),
    "100%",
  );

  // Still there after a reload, with bob's tab and zoom restored.
  await bob.page.reload();
  await bob.page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
  await rig.waitForClientInTree(bob.page, bob.nick);
  await openApps(bob.page, rig);
  await until(async () => (await tabs(bob.page).count()) === 1, "bob's tab comes back");
  assert.equal((await bob.page.getByTestId("apps-zoom-level").innerText()).trim(), "80%");

  // Alice removes it for everyone; bob's list and tab follow.
  await entries(a).first().hover();
  await a.locator(".apps .entry-remove").first().click();
  await a.locator("[role=dialog][aria-modal=true] button.danger").click();
  await until(async () => (await entries(bob.page).count()) === 0, "bob's list empties");
  assert.equal(await tabs(bob.page).count(), 0, "bob's tab closes with it");

  // The header's close-all button shuts the whole group; the desktop icon reopens it.
  await bob.page
    .locator(".dv-groupview", { has: bob.page.locator(".dv-tab", { hasText: "Apps" }) })
    .getByTestId("dock-close-group")
    .click();
  await bob.page.locator(".apps").waitFor({ state: "detached" });
  await openApps(bob.page, rig);
}
