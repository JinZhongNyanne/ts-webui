/**
 * M2 client moderation, end to end against the live server: an admin moves a
 * client by drag and drop and through "Move to…" (into a channel with a
 * password), kicks from the channel and from the server (the victim sees
 * both), assigns a server group and a channel group, denies a talk request,
 * and toggles channel commander. A normal user is not offered what their
 * permissions rule out, and gets the server's refusal (naming the
 * permission) for what the page cannot know. A dialog open on someone who
 * leaves never acts on whoever takes over their client id.
 */
import assert from "node:assert/strict";
import { until } from "../lib/rig.mjs";

export const title = "m2 moderation: move, kick, groups, talk request deny, channel commander";

const escapeRe = (s) => s.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&");

const clientRow = (page, nick) =>
  page.locator(".tree .client").filter({
    has: page.locator(".nick", { hasText: new RegExp(`^\\s*${escapeRe(nick)}\\s*$`) }),
  });

const channelRow = (page, name) =>
  page.locator(".tree .channel").filter({
    has: page.locator(".channel-name", { hasText: new RegExp(`^${escapeRe(name)}$`) }),
  });

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

const clientInfo = async (rig, clid) => (await rig.sq.cmd("clientinfo", { clid }))[0];

/** The page's system log lines (dev builds expose the store as `__jinzTs`). */
const events = (page) => page.evaluate(() => window.__jinzTs.events().map((e) => e.text));

async function waitForEvent(page, re, what) {
  await until(async () => (await events(page)).some((t) => re.test(t)), what, 15_000);
}

/** The page's perms store, as the menus read it. */
const perms = (page, fn, name) =>
  page.evaluate(
    async ([f, n]) => {
      const { usePermsStore } = await import("/src/stores/perms.ts");
      return usePermsStore()[f](n);
    },
    [fn, name],
  );

async function moveByDrag(rig, admin, victim) {
  const b = rig.channels.name("b");
  await clientRow(admin.page, victim.nick).dragTo(channelRow(admin.page, b));
  await until(
    async () => (await clientInfo(rig, victim.clid)).cid === rig.channels.b,
    "the victim was dragged into channel b",
  );
  await waitForEvent(victim.page, new RegExp(`${escapeRe(admin.nick)} moved you`), "victim told");
}

async function moveByDialog(rig, admin, victim, pw) {
  const { page } = admin;
  await menu(page, clientRow(page, victim.nick), "Move to…");
  const dialog = dialogOf(page, "move-dialog");
  const search = dialog.locator("input[type=search]");
  await search.fill(pw.name.slice(-8));
  const rows = dialog.locator("[role=option]");
  await until(async () => (await rows.count()) === 1, "the search narrows the list to one");
  // Picked from the keyboard: the arrow key selects, the search box points at it.
  await search.press("ArrowDown");
  assert.equal(await rows.first().getAttribute("aria-selected"), "true", "arrow key picks");
  assert.equal(
    await search.getAttribute("aria-activedescendant"),
    await rows.first().getAttribute("id"),
    "the search box names the picked row",
  );
  // A password channel asks for it; an admin may leave it empty.
  await dialog.getByTestId("move-password").waitFor({ timeout: 5_000 });
  await page.screenshot({ path: rig.artifact("m2-move-dialog.png") });
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(
    async () => (await clientInfo(rig, victim.clid)).cid === pw.cid,
    "the victim was moved into the password channel",
  );
}

async function kickFromChannel(rig, admin, victim) {
  const { page } = admin;
  const reason = `m2 channel kick ${rig.runId}`;
  await menu(page, clientRow(page, victim.nick), "Kick from channel…");
  const dialog = dialogOf(page, "kick-dialog");
  await dialog.locator("input").fill(reason);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  const [def] = (await rig.sq.cmd("channellist", {}, ["flags"])).filter(
    (c) => c.channel_flag_default === "1",
  );
  await until(
    async () => (await clientInfo(rig, victim.clid)).cid === def.cid,
    "the victim is in the default channel",
  );
  await waitForEvent(
    victim.page,
    new RegExp(`${escapeRe(admin.nick)} kicked you from the channel \\(${escapeRe(reason)}\\)`),
    "the victim sees who kicked them and why",
  );
}

async function serverGroups(rig, admin, victim) {
  const { page } = admin;
  const groups = await rig.sq.cmd("servergrouplist");
  const normal = groups.find((g) => g.type === "1" && g.name === "Normal");
  assert.ok(normal, "the server has a regular 'Normal' group");
  const members = async () =>
    (await rig.sq.cmd("servergroupclientlist", { sgid: normal.sgid }).catch(() => [])).map(
      (m) => m.cldbid,
    );

  await menu(page, clientRow(page, victim.nick), "Server groups…");
  const dialog = dialogOf(page, "server-groups-dialog");
  const labels = await dialog.locator("label.group").allInnerTexts();
  assert.ok(!labels.some((l) => /Server Query/.test(l)), "query groups are not offered");
  const box = dialog.locator(`label[data-sgid="${normal.sgid}"] input`);
  assert.equal(await box.isChecked(), false);
  await box.check();
  await until(async () => (await members()).includes(victim.dbId), "added to Normal");
  await until(() => box.isChecked(), "the box follows the server");
  await page.screenshot({ path: rig.artifact("m2-server-groups.png") });

  // Our copy of the client lags (as if a notify went missing): ticking the
  // group again gets "duplicate entry" (2561), which means "already a member".
  await dropGroupFromCopy(page, victim.clid, normal.sgid);
  await until(async () => !(await box.isChecked()), "the stale copy shows the box unticked");
  await box.check();
  await until(() => box.isChecked(), "2561 keeps the box ticked");
  assert.equal(await dialog.locator("[role=alert]").count(), 0, "2561 is not an error");
  assert.ok((await members()).includes(victim.dbId), "still in Normal");

  await box.uncheck();
  await until(async () => !(await members()).includes(victim.dbId), "removed from Normal");
  await liveGroupList(rig, dialog);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached", timeout: 5_000 });
}

/** Takes a group out of the page's copy of a client, not on the server (dev builds only). */
function dropGroupFromCopy(page, clid, sgid) {
  return page.evaluate(
    ({ clid, sgid }) => {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const c = pinia._s.get("ts").clients.get(Number(clid));
      c.serverGroups = c.serverGroups.filter((g) => g !== sgid);
    },
    { clid, sgid },
  );
}

/**
 * Groups added, renamed and deleted while connected show up in an open
 * dialog: the server resends the whole group list after each change, and the
 * hub replaces its list with it (a deleted group used to stay until reconnect).
 */
async function liveGroupList(rig, dialog) {
  const name = `${rig.prefix}-sg`;
  const [created] = await rig.sq.cmd("servergroupadd", { name, type: 1 });
  let sgid = created.sgid;
  try {
    const label = dialog.locator(`label[data-sgid="${sgid}"]`);
    // The name alone: an admin's row also carries the set-icon button, whose
    // glyph would otherwise be part of the label's text.
    const shownName = async () => (await label.locator("span").first().innerText()).trim();
    await label.waitFor({ timeout: 10_000 });
    assert.equal(await shownName(), name, "a new group appears");
    await rig.sq.cmd("servergrouprename", { sgid, name: `${name}-renamed` });
    await until(
      async () => (await shownName()) === `${name}-renamed`,
      "a renamed group is renamed",
    );
    await rig.sq.cmd("servergroupdel", { sgid, force: 1 });
    sgid = null;
    await label.waitFor({ state: "detached", timeout: 10_000 });
  } finally {
    if (sgid) await rig.sq.cmd("servergroupdel", { sgid, force: 1 }).catch(() => undefined);
  }
}

async function channelGroup(rig, admin, victim) {
  const { page } = admin;
  const groups = await rig.sq.cmd("channelgrouplist");
  const op = groups.find((g) => g.type === "1" && g.name === "Operator");
  const guest = groups.find((g) => g.type === "1" && g.name === "Guest");
  const cgidOf = async () => (await clientInfo(rig, victim.clid)).client_channel_group_id;

  await menu(page, clientRow(page, victim.nick), "Channel group…");
  const dialog = dialogOf(page, "channel-group-dialog");
  await dialog.locator(`label[data-cgid="${op.cgid}"] input`).check();
  await until(async () => (await cgidOf()) === op.cgid, "victim is Operator in their channel");
  await dialog.locator(`label[data-cgid="${guest.cgid}"] input`).check();
  await until(async () => (await cgidOf()) === guest.cgid, "and back to Guest");
  await page.keyboard.press("Escape");
}

async function denyTalkRequest(rig, admin, victim, talk) {
  const vp = victim.page;
  await channelRow(vp, talk.name).dblclick();
  await until(async () => (await clientInfo(rig, victim.clid)).cid === talk.cid, "in talk channel");
  const request = async (reason) => {
    await vp.getByTestId("status-talk-request").click();
    const dialog = dialogOf(vp, "talk-request-dialog");
    await dialog.locator("input").fill(reason);
    await dialog.locator("button[type=submit]").click();
    await dialog.waitFor({ state: "detached", timeout: 10_000 });
    await until(
      async () => (await clientInfo(rig, victim.clid)).client_talk_request !== "0",
      "the request is pending",
    );
  };
  const denied = () =>
    until(async () => {
      const info = await clientInfo(rig, victim.clid);
      return info.client_talk_request === "0" && info.client_is_talker === "0";
    }, "the request is gone, and no talk power was given");

  // From the menu, which shows what they asked for.
  const reason = `m2 may I ${rig.runId}`.slice(0, 50);
  await request(reason);
  const row = clientRow(admin.page, victim.nick);
  await row.getByTestId("talk-request-marker").waitFor({ timeout: 10_000 });
  const labels = await menuLabels(admin.page, row);
  assert.ok(
    labels.some((l) => l.includes(reason)),
    "the menu shows the request's message",
  );
  await menu(admin.page, row, "Deny talk request");
  await denied();
  await row.getByTestId("talk-request-marker").waitFor({ state: "detached", timeout: 10_000 });

  // And from the info panel.
  await request("again");
  await row.click();
  await admin.page.getByTestId("info-talk-deny").click();
  await denied();
}

async function commander(rig, admin) {
  const { page } = admin;
  const self = clientRow(page, admin.nick);
  await menu(page, self, "Channel commander");
  await until(
    async () => (await clientInfo(rig, admin.clid)).client_is_channel_commander === "1",
    "the admin is channel commander",
  );
  await self.locator(".flag", { hasText: "★" }).waitFor({ timeout: 10_000 });
  await menu(page, self, "Channel commander");
  await until(
    async () => (await clientInfo(rig, admin.clid)).client_is_channel_commander === "0",
    "and not any more",
  );
}

async function normalUser(rig, norm, admin) {
  const { page } = norm;
  await rig.waitForClientInTree(page, admin.nick);
  const labels = await menuLabels(page, clientRow(page, admin.nick));
  const expect = [
    ["Move to…", "i_client_move_power"],
    ["Kick from channel…", "i_client_kick_from_channel_power"],
    ["Kick from server…", "i_client_kick_from_server_power"],
  ];
  for (const [label, power] of expect) {
    const offered = await perms(page, "mayUse", power);
    assert.equal(labels.includes(label), offered, `"${label}" follows mayUse(${power})`);
  }
  const selfLabels = await menuLabels(page, clientRow(page, norm.nick));
  const commanderFlag = await perms(page, "has", "b_client_use_channel_commander");
  assert.equal(selfLabels.includes("Channel commander"), commanderFlag, "commander follows flag");
  rig.log(`normal user is offered: ${labels.filter((l) => /…$/.test(l)).join(", ")}`);

  // Where offered anyway (powers unknown), the server refuses, naming the permission.
  if (labels.includes("Kick from server…")) {
    await menu(page, clientRow(page, admin.nick), "Kick from server…");
    const dialog = dialogOf(page, "kick-dialog");
    await dialog.locator("button[type=submit]").click();
    const error = dialog.locator(".note.error");
    await error.waitFor({ timeout: 10_000 });
    assert.match(await error.innerText(), /^Insufficient permissions \(needs i_client_\w+\)$/);
    await page.screenshot({ path: rig.artifact("m2-normal-refused.png") });
    await page.keyboard.press("Escape");
  }
  const online = await rig.sq.cmd("clientlist");
  assert.ok(
    online.some((c) => c.clid === admin.clid),
    "the admin is still online",
  );
}

async function kickFromServer(rig, admin, victim) {
  const { page } = admin;
  const reason = `m2 server kick ${rig.runId}`;
  await menu(page, clientRow(page, victim.nick), "Kick from server…");
  const dialog = dialogOf(page, "kick-dialog");
  await dialog.locator("input").fill(reason);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(
    async () => !(await rig.sq.cmd("clientlist")).some((c) => c.clid === victim.clid),
    "the victim is off the server",
  );
  await clientRow(page, victim.nick).waitFor({ state: "detached", timeout: 10_000 });
  await waitForEvent(victim.page, new RegExp(escapeRe(reason)), "the victim sees the reason");
  await waitForEvent(
    page,
    new RegExp(`${escapeRe(victim.nick)} was kicked from the server by ${escapeRe(admin.nick)}`),
    "the admin's log says so too",
  );
  await victim.page.screenshot({ path: rig.artifact("m2-kicked-victim.png") });
}

/** Drops `client` off the server behind the page's back, as a leave would. */
async function dropFromServer(rig, client) {
  await rig.sq.cmd("clientkick", { clid: client.clid, reasonid: 5, reasonmsg: "e2e leave" });
  await until(
    async () => !(await rig.sq.cmd("clientlist")).some((c) => c.clid === client.clid),
    `${client.nick} is off the server`,
  );
}

/**
 * TeamSpeak hands a freed client id to the next client that joins, so a
 * dialog open on someone who leaves must not quietly retarget: the kick
 * dialog closes, and the ban dialog falls back to the leaver's UID.
 */
async function targetLeaves(rig, admin) {
  const { page } = admin;
  const leaver = await rig.connect("leaver", { channel: "a" });
  await rig.waitForClientInTree(page, leaver.nick);
  await menu(page, clientRow(page, leaver.nick), "Kick from server…");
  const kick = dialogOf(page, "kick-dialog");
  await kick.waitFor({ timeout: 5_000 });
  await dropFromServer(rig, leaver);
  await kick.waitFor({ state: "detached", timeout: 10_000 });

  // Whoever joins next may get the id; with the dialog gone nothing can act on them.
  const heir = await rig.connect("heir", { channel: "a" });
  rig.log(`leaver had clid ${leaver.clid}, the next client got ${heir.clid}`);
  await rig.waitForClientInTree(page, heir.nick);
  assert.ok(
    (await rig.sq.cmd("clientlist")).some((c) => c.clid === heir.clid),
    "the next client is still online",
  );

  // The ban dialog, in "ban the client" mode, switches to the leaver's UID rule.
  const heirUid = await heir.page.evaluate(() => window.__jinzTs.self().uid);
  await menu(page, clientRow(page, heir.nick), "Ban…");
  const ban = dialogOf(page, "ban-dialog");
  await ban.locator("input[type=radio][value=client]").check();
  await dropFromServer(rig, heir);
  await page.getByTestId("ban-target-left").waitFor({ timeout: 10_000 });
  assert.equal(
    await ban.locator("input[name=uid]").inputValue(),
    heirUid,
    "the rule keeps the UID of who the dialog was opened for",
  );
  assert.equal(await ban.locator("input[type=radio]").count(), 0, "no client mode left");
  await page.screenshot({ path: rig.artifact("m2-ban-target-left.png") });
  await ban.getByRole("button", { name: "Cancel" }).click();
  await ban.waitFor({ state: "detached", timeout: 5_000 });
}

export default async function m2Moderation(rig) {
  const make = async (suffix, extra) => {
    const name = `${rig.prefix}-${suffix}`;
    const [rec] = await rig.sq.cmd("channelcreate", {
      channel_name: name,
      cpid: rig.channels.root,
      channel_flag_semi_permanent: 1,
      ...extra,
    });
    return { cid: rec.cid, name };
  };
  const pw = await make("locked", { channel_password: "m2secret" });
  const talk = await make("talk", { channel_needed_talk_power: 10 });
  try {
    const admin = await rig.connect("admin", { channel: "a", admin: true });
    const victim = await rig.connect("victim", { channel: "a" });
    const norm = await rig.connect("norm", { channel: "b" });
    await rig.waitForClientInTree(admin.page, victim.nick);

    await moveByDrag(rig, admin, victim);
    rig.log("drag move ok");
    await moveByDialog(rig, admin, victim, pw);
    rig.log("move dialog ok");
    await kickFromChannel(rig, admin, victim);
    rig.log("channel kick ok");
    await serverGroups(rig, admin, victim);
    rig.log("server groups ok");
    await channelGroup(rig, admin, victim);
    rig.log("channel group ok");
    await denyTalkRequest(rig, admin, victim, talk);
    rig.log("talk request deny ok");
    await commander(rig, admin);
    rig.log("channel commander ok");
    await normalUser(rig, norm, admin);
    rig.log("normal user ok");
    await kickFromServer(rig, admin, victim);
    rig.log("server kick ok");
    await targetLeaves(rig, admin);
    rig.log("target leaving closes / pins the dialogs ok");
  } finally {
    for (const c of [pw, talk]) {
      await rig.sq.cmd("channeldelete", { cid: c.cid, force: 1 }).catch(() => undefined);
    }
  }
}
