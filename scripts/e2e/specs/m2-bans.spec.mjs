/**
 * M2 bans, end to end against the live server: an admin bans a client from
 * the tree's context menu (the victim is dropped and told who banned it and
 * why), the ban shows in the ban list (server menu), the victim cannot get
 * back in until the ban is deleted there, a ban is edited (new ban, old one
 * gone), and a ban added by UID from the list drops that client too. Being
 * banned raises the "Banned from server" desktop notification (sound pack).
 *
 * Every e2e client connects from the same address, so nothing here bans by
 * IP: `banclient` (which bans the IP along with the UID) is only tried to see
 * the hub refuse it on a web user, and the bad rules are caught in the
 * dialog before anything is sent. The bans are on the victims' fresh UIDs. Whatever the spec created is deleted
 * again in `finally`, so a failed run cannot lock anyone out.
 */
import assert from "node:assert/strict";
import { until } from "../lib/rig.mjs";

export const title = "m2 bans: ban from the menu, ban list, delete, edit, add by UID";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const clientRow = (page, nick) =>
  page.locator(".tree .client").filter({
    has: page.locator(".nick", { hasText: new RegExp(`^\\s*${escapeRe(nick)}\\s*$`) }),
  });

/** Right-clicks `row` and picks the context-menu entry labelled `label`. */
async function menu(page, row, label) {
  await row.first().click({ button: "right" });
  const item = page.locator(".cm-item .cm-label", { hasText: label }).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
}

async function menuLabels(page, row) {
  await row.first().click({ button: "right" });
  await page.locator(".cm-item").first().waitFor({ state: "visible", timeout: 5_000 });
  const labels = await page.locator(".cm-item .cm-label").allInnerTexts();
  await page.keyboard.press("Escape");
  return labels.map((l) => l.trim());
}

const dialogOf = (page, testId) =>
  page.locator("[role=dialog][aria-modal=true]").filter({ has: page.getByTestId(testId) });

const selfUid = (client) => client.page.evaluate(() => window.__jinzTs.self().uid);

const serverBans = async (rig) => rig.serverQuery("banlist").catch(() => []);

/**
 * Swaps the page's Notification API for a recorder, marks the page unfocused
 * (notifications only go out when the tab is not in front) and turns desktop
 * notifications on through the page's own store, as the settings pane would.
 */
function recordNotifications(page) {
  return page.evaluate(() => {
    const notes = [];
    window.__jinzNotes = notes;
    window.Notification = class {
      static permission = "granted";
      static requestPermission = async () => "granted";
      constructor(title, options) {
        notes.push({ title, body: options?.body ?? "" });
      }
      close() {}
    };
    document.hasFocus = () => false;
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    pinia._s.get("notify").notifications = true;
  });
}

/** Fills the ban dialog's rule form (UID only) and submits it. */
async function submitUidBan(dialog, { uid, preset, reason }) {
  if (uid !== undefined) await dialog.locator("input[name=uid]").fill(uid);
  await dialog.locator("select[name=duration]").selectOption({ label: preset });
  await dialog.locator("input[name=reason]").fill(reason);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
}

/** Waits for the page to show the ban notice and to be off the server. */
async function expectBanned(rig, victim, adminNick, reason) {
  await victim.page
    .getByText(`You were banned by ${adminNick}`, { exact: false })
    .first()
    .waitFor({ timeout: 15_000 });
  const text = await victim.page.locator("body").innerText();
  assert.ok(text.includes(reason), "the notice carries the reason");
  await until(
    async () => !(await rig.serverQuery("clientlist")).some((c) => c.clid === victim.clid),
    `${victim.nick} is off the server`,
  );
}

async function tryReconnect(page) {
  await page.locator("form.dialog button[type=submit]").click({ timeout: 15_000 });
}

export default async function (rig) {
  const reason = `m2bans ${rig.runId}`;
  const ours = (b) => String(b.reason ?? "").startsWith(reason);
  const admin = await rig.connect("ban-admin", { admin: true });
  const victim = await rig.connect("ban-victim");
  const victimUid = await selfUid(victim);
  const { page } = admin;

  try {
    // --- a plain user is offered neither (no b_client_ban_create / _list) ---
    await rig.waitForClientInTree(victim.page, admin.nick);
    const labels = [
      ...(await menuLabels(victim.page, clientRow(victim.page, admin.nick))),
      ...(await menuLabels(victim.page, victim.page.locator(".tree .server-row"))),
    ];
    assert.ok(!labels.includes("Ban…"), `no ban entry for a plain user: ${labels}`);
    assert.ok(!labels.includes("Ban list"), `no ban list for a plain user: ${labels}`);

    // --- ban from the client menu, by UID ---
    await rig.waitForClientInTree(page, victim.nick);
    await menu(page, clientRow(page, victim.nick), "Ban…");
    const dialog = dialogOf(page, "ban-dialog");
    // UID is the default: banclient's IP half would hit every web user (one hub, one IP).
    assert.ok(await dialog.locator("input[type=radio][value=rule]").isChecked(), "UID by default");
    await dialog.locator("input[type=radio][value=client]").check();
    await dialog.getByText("shares its IP", { exact: false }).waitFor({ timeout: 3_000 });
    await page.screenshot({ path: rig.artifact("ban-dialog.png") });
    // The hub refuses it outright: the victim is another web user. (Five
    // seconds, so even a regression could not lock the rig out for long.)
    await dialog.locator("select[name=duration]").selectOption({ label: "Custom…" });
    await dialog.locator("input[name=amount]").fill("5");
    await dialog.locator("select[name=unit]").selectOption("s");
    await dialog.locator("input[name=reason]").fill(`${reason} client`);
    await dialog.locator("button[type=submit]").click();
    await dialog
      .getByText("would ban every web user", { exact: false })
      .waitFor({ timeout: 10_000 });
    assert.ok(!(await serverBans(rig)).some(ours), "banclient on a web user bans nothing");
    await page.screenshot({ path: rig.artifact("ban-dialog-refused.png") });
    await dialog.locator("input[type=radio][value=rule]").check();
    // Rules that would catch every web user are caught under their fields.
    await dialog.locator("input[name=ip]").fill("10.0.*");
    await dialog.locator("input[name=ip]").blur();
    await dialog
      .getByText("one IPv4 or IPv6 address", { exact: false })
      .waitFor({ timeout: 3_000 });
    await dialog.locator("input[name=ip]").fill("");
    await dialog.locator("input[name=name]").fill(".*");
    await dialog.locator("input[name=name]").blur();
    await dialog.getByText("match almost anyone", { exact: false }).waitFor({ timeout: 3_000 });
    await dialog.locator("input[name=name]").fill("");
    assert.equal(
      await dialog.locator("input[name=uid]").inputValue(),
      victimUid,
      "rule mode starts from the client's UID",
    );
    await recordNotifications(victim.page);
    await submitUidBan(dialog, { preset: "1 h", reason });
    await expectBanned(rig, victim, admin.nick, reason);
    const notes = await victim.page.evaluate(() => window.__jinzNotes);
    const note = notes.find((n) => n.title === "Banned from server");
    assert.ok(note, `a "banned" desktop notification: ${JSON.stringify(notes)}`);
    assert.equal(note.body, `${admin.nick}: ${reason}`, "it says who banned us and why");
    assert.ok(!notes.some((n) => n.title === "Connection lost"), "not also 'connection lost'");

    const ban = (await serverBans(rig)).find((b) => b.uid === victimUid && ours(b));
    assert.ok(ban, "the server has a UID ban");
    assert.equal(ban.duration, "3600");
    assert.equal(ban.ip ?? "", "", "nothing was banned by IP");

    // --- the ban list shows it; the victim stays out ---
    await menu(page, page.locator(".tree .server-row"), "Ban list");
    const list = dialogOf(page, "ban-list");
    const row = list.locator(`tr.ban[data-banid="${ban.banid}"]`);
    await row.waitFor({ timeout: 10_000 });
    await page.screenshot({ path: rig.artifact("ban-list.png") });
    await victim.page.screenshot({ path: rig.artifact("banned-victim.png") });
    assert.ok((await row.innerText()).includes(reason), "the row shows the reason");
    await list.locator("input[type=search]").fill(rig.runId);
    await row.waitFor({ timeout: 3_000 });
    await list.locator("input[type=search]").fill(`no such ban ${rig.runId}`);
    await row.waitFor({ state: "detached", timeout: 3_000 });
    await list.locator("input[type=search]").fill("");

    await tryReconnect(victim.page);
    await victim.page
      .getByText("You are banned from this server", { exact: false })
      .first()
      .waitFor({ timeout: 20_000 });

    // --- edit: a new ban replaces the old one ---
    await row.locator("button.edit").click();
    const edit = dialogOf(page, "ban-dialog");
    await edit.locator("input[name=reason]").fill(`${reason} edited`);
    await edit.locator("button[type=submit]").click();
    await edit.waitFor({ state: "detached", timeout: 10_000 });
    await row.waitFor({ state: "detached", timeout: 10_000 });
    const edited = await until(
      async () => (await serverBans(rig)).find((b) => b.uid === victimUid && ours(b)),
      "the edited ban is on the server",
    );
    assert.notEqual(edited.banid, ban.banid, "the edit is a new ban");
    assert.equal(edited.reason, `${reason} edited`);
    assert.ok(
      !(await serverBans(rig)).some((b) => b.banid === ban.banid),
      "the old ban is deleted",
    );

    // --- delete it (after a confirm naming it); the victim gets back in ---
    const del = list.locator(`tr.ban[data-banid="${edited.banid}"] button.delete`);
    assert.match(String(await del.getAttribute("aria-label")), /^Delete the ban on /);
    await del.click();
    const confirmOne = page
      .locator("[role=dialog][aria-modal=true]")
      .filter({ hasText: "Delete this ban?" });
    await confirmOne.waitFor({ timeout: 5_000 });
    await confirmOne.getByRole("button", { name: "Delete", exact: true }).click();
    await list.locator(`tr.ban[data-banid="${edited.banid}"]`).waitFor({ state: "detached" });
    assert.ok(!(await serverBans(rig)).some((b) => b.banid === edited.banid), "ban deleted");
    await tryReconnect(victim.page);
    await until(
      () => victim.page.evaluate(() => window.__jinzTs?.self?.() ?? null),
      "the victim reconnects once the ban is gone",
      30_000,
    );

    // --- add by UID from the list, no target ---
    const second = await rig.connect("ban-victim2");
    const secondUid = await selfUid(second);
    await list.getByRole("button", { name: "Add ban…" }).click();
    const add = dialogOf(page, "ban-dialog");
    assert.equal(
      await add.locator("input[type=radio]").count(),
      0,
      "without a target there is only the rule form",
    );
    await submitUidBan(add, { uid: secondUid, preset: "10 min", reason: `${reason} by uid` });
    await expectBanned(rig, second, admin.nick, `${reason} by uid`);
    const byUid = await until(
      async () => (await serverBans(rig)).find((b) => b.uid === secondUid && ours(b)),
      "the UID ban is on the server",
    );
    assert.equal(byUid.duration, "600");
    await list.locator(`tr.ban[data-banid="${byUid.banid}"]`).waitFor({ timeout: 10_000 });

    // "Delete all" asks first; answering no leaves everything alone.
    await list.getByRole("button", { name: "Delete all" }).click();
    const confirm = page
      .locator("[role=dialog][aria-modal=true]")
      .filter({ hasText: "Delete every ban?" });
    await confirm.waitFor({ timeout: 5_000 });
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await confirm.waitFor({ state: "detached", timeout: 5_000 });
    assert.ok(
      (await serverBans(rig)).some((b) => b.banid === byUid.banid),
      "cancelling 'delete all' deletes nothing",
    );
  } finally {
    // Never leave a ban behind: other runs share this server.
    for (const b of await serverBans(rig)) {
      if (!ours(b)) continue;
      await rig.sq
        .cmd("bandel", { banid: b.banid })
        .then(() => rig.log(`deleted ban ${b.banid}`))
        .catch((e) => rig.log(`could not delete ban ${b.banid}: ${e.message}`));
    }
  }
}
