/**
 * M4 server administration, end to end against the live server:
 *  - a guest is offered none of the admin windows, redeems the rig's
 *    privilege key from the server menu (a wrong key is refused first) and
 *    lands in Server Admin; another client redeems a key typed into the
 *    connect dialog's "More options" once connected;
 *  - an admin renames the virtual server and sets a host banner, another
 *    client sees the new name, and the banner waits behind a click (no
 *    request reaches the banner's host until then) and is remembered for
 *    that server; both are restored afterwards;
 *  - server and channel groups are added, renamed, given a sort id, copied
 *    and deleted, each checked through ServerQuery;
 *  - the server log shows the rename and the group changes;
 *  - the server info shows live connection numbers;
 *  - the permission overview explains where a permission comes from;
 *  - the new windows fit a phone.
 *
 * The rename, the banner and the server log setting are the only
 * server-wide changes, and each is put back in a `finally`; groups and the
 * extra privilege key are deleted there too.
 */
import assert from "node:assert/strict";
import { until } from "../lib/rig.mjs";

export const title =
  "m4 server admin: privilege keys, virtual server edit, groups, log, connection info, banner gate";

const BANNER_HOST = "banner.e2e.invalid";
const BANNER_URL = `https://${BANNER_HOST}/m4-banner.png`;
/** A 1×1 transparent PNG, served for the banner through Playwright's router. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const escapeRe = (s) => s.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&");

const serverRow = (page) => page.locator(".tree .server-row").first();

const clientRow = (page, nick) =>
  page.locator(".tree .client").filter({
    has: page.locator(".nick", { hasText: new RegExp(`^\\s*${escapeRe(nick)}\\s*$`) }),
  });

/** Right-clicks `row` and picks the context-menu entry whose label matches `label`. */
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

/** Answers the app's confirmDialog with its (danger) confirm button. */
async function confirm(page) {
  const box = page
    .locator("[role=dialog][aria-modal=true]")
    .filter({ has: page.locator("button.danger") });
  await box.locator("button.danger").click();
}

async function closeDialog(page) {
  await page.keyboard.press("Escape");
  await page
    .locator("[role=dialog][aria-modal=true]")
    .first()
    .waitFor({ state: "detached", timeout: 5_000 });
}

const inGroup = (client, sgid) =>
  client.page.evaluate(
    (id) => window.__jinzTs?.self?.()?.serverGroups?.includes(id) ?? false,
    sgid,
  );

const sqList = async (rig, cmd) =>
  rig.sq.cmd(cmd).catch((err) => {
    if (err.id === 1281) return [];
    throw err;
  });

/* -------------------------------------------------------------- tests */

async function gating(guest) {
  const labels = await menuLabels(guest.page, serverRow(guest.page));
  assert.ok(labels.includes("Use privilege key…"), `a guest may redeem a key: ${labels}`);
  for (const hidden of [
    "Privilege keys",
    "Server and channel groups",
    "Edit virtual server…",
    "Server log",
  ]) {
    assert.ok(!labels.includes(hidden), `a guest is not offered ${hidden}: ${labels.join(", ")}`);
  }
}

async function redeemFromMenu(rig, guest) {
  const { page } = guest;
  await menu(page, serverRow(page), "Use privilege key…");
  const dialog = dialogOf(page, "pk-use-dialog");
  await dialog.waitFor({ timeout: 10_000 });
  // A key the server does not know is refused under the field.
  await dialog.getByTestId("pk-use-input").fill("bogusKey1234567890");
  await dialog.getByTestId("pk-use-submit").click();
  await dialog.locator(".field", { hasText: "not valid" }).waitFor({ timeout: 10_000 });
  // The real one, pasted with a line break in it (as from a chat).
  const key = rig.privilegeKey;
  await dialog.getByTestId("pk-use-input").fill(`${key.slice(0, 20)}\n${key.slice(20)}`);
  await dialog.getByTestId("pk-use-submit").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(() => inGroup(guest, rig.adminGroupId), "the guest is in Server Admin", 15_000);
  const [info] = await rig.sq.cmd("clientinfo", { clid: guest.clid });
  assert.ok(
    info.client_servergroups.split(",").includes(String(rig.adminGroupId)),
    "ServerQuery agrees",
  );
}

/** A fresh key for Normal, typed into the connect dialog of a client that reconnects. */
async function redeemFromConnectDialog(rig, client) {
  const groups = await rig.sq.cmd("servergrouplist");
  const normal = groups.find((g) => g.name === "Normal" && g.type === "1");
  assert.ok(normal, "the server has a Normal group");
  const [rec] = await rig.sq.cmd("privilegekeyadd", {
    tokentype: 0,
    tokenid1: normal.sgid,
    tokenid2: 0,
    tokendescription: `${rig.prefix} m4 connect`,
  });
  try {
    await client.page.goto("about:blank");
    await until(
      async () => !(await rig.sq.cmd("clientlist")).some((c) => c.client_nickname === client.nick),
      `${client.nick} is offline`,
    );
    await client.page.goto(rig.webUrl, { waitUntil: "domcontentloaded" });
    const more = client.page.getByTestId("connect-more");
    await more.locator("summary").click();
    await client.page.getByTestId("connect-privilege-key").fill(rec.token);
    await client.page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
    await until(
      () => client.page.evaluate(() => window.__jinzTs?.self?.() ?? null),
      `${client.nick} reconnects`,
      45_000,
    );
    await until(() => inGroup(client, normal.sgid), `${client.nick} is in Normal`, 15_000);
    const stored = await client.page.evaluate(() => localStorage.getItem("jinz.ts.profile") ?? "");
    assert.ok(!stored.includes(rec.token), "the key is not saved with the profile");
    const now = await rig.sq.cmd("clientlist");
    client.clid = now.find((c) => c.client_nickname === client.nick)?.clid ?? client.clid;
  } finally {
    await rig.sq.cmd("privilegekeydelete", { token: rec.token }).catch(() => undefined);
  }
}

/** Renames the server and sets a banner in the edit dialog; returns what to restore. */
async function editServer(rig, admin, watcher, newName) {
  const { page } = admin;
  await menu(page, serverRow(page), "Edit virtual server…");
  const dialog = dialogOf(page, "srvedit-dialog");
  await dialog.waitFor({ timeout: 10_000 });
  await until(async () => (await dialog.getByTestId("srvedit-name").inputValue()) !== "", "loaded");
  await dialog.getByTestId("srvedit-name").fill(newName);
  await dialog.getByTestId("srvedit-banner-gfx").fill(BANNER_URL);
  await dialog.getByTestId("srvedit-save").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  const [info] = await rig.sq.cmd("serverinfo");
  assert.equal(info.virtualserver_name, newName, "ServerQuery sees the new name");
  assert.equal(info.virtualserver_hostbanner_gfx_url, BANNER_URL, "and the banner");
  await until(
    async () => ((await serverRow(watcher.page).innerText()) ?? "").includes(newName),
    "the watcher's tree shows the new name",
    15_000,
  );
}

/** D2: the banner loads only after a click, and "always" is remembered for this server. */
async function bannerGate(watcher) {
  const { page, context } = watcher;
  let requests = 0;
  await context.route(`https://${BANNER_HOST}/**`, (route) => {
    requests++;
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX });
  });
  await serverRow(page).click();
  const gate = page.getByTestId("host-image-gate");
  await gate.waitFor({ timeout: 15_000 });
  assert.match(await gate.innerText(), new RegExp(escapeRe(BANNER_HOST)), "it names the host");
  await page.waitForTimeout(500);
  assert.equal(requests, 0, "nothing reaches the banner's host before the click");
  await page.getByTestId("host-image-always").click();
  await page.locator(".banner [data-testid=host-image]").waitFor({ timeout: 10_000 });
  await until(() => requests > 0, "the banner is fetched after the click", 5_000);
  const stored = await page.evaluate(() => localStorage.getItem("jinz.server.bannerConsents"));
  assert.match(stored ?? "", new RegExp(escapeRe(BANNER_HOST)), "the choice is remembered");
  return requests;
}

async function groups(rig, admin, names) {
  const { page } = admin;
  await menu(page, serverRow(page), "Server and channel groups");
  const dialog = dialogOf(page, "groups-dialog");
  await dialog.waitFor({ timeout: 10_000 });
  const row = (name) =>
    dialog.getByTestId("group-row").filter({
      has: page.locator("[data-testid=group-name]", {
        hasText: new RegExp(`^\\s*${escapeRe(name)}\\s*$`),
      }),
    });
  const sgByName = async (name) =>
    (await rig.sq.cmd("servergrouplist")).find((g) => g.name === name);
  /**
   * Whether the page's own group lists — the ones the server pushes after
   * every change, which the tree, the client menus and the group pickers
   * read — carry `name`, of `kind` ("server" or "channel").
   */
  const pushedHas = (kind, name) =>
    page.evaluate(({ kind, name }) => window.__jinzTs?.groups?.()[kind].includes(name) ?? false, {
      kind,
      name,
    });

  // Add.
  await dialog.getByTestId("group-new-name").fill(names.server);
  await dialog.getByTestId("group-add").click();
  await row(names.server).waitFor({ timeout: 10_000 });
  const added = await until(() => sgByName(names.server), "ServerQuery lists the new group");
  assert.equal(added.type, "1", "a regular group");

  // A name already taken is refused before it reaches the server.
  await dialog.getByTestId("group-new-name").fill(names.server);
  await dialog.getByTestId("group-add").click();
  await dialog.locator(".err", { hasText: "already a group" }).waitFor({ timeout: 5_000 });
  await dialog.getByTestId("group-new-name").fill("");

  // Rename and give it a sort id and a name display, in one save.
  await row(names.server).getByTestId("group-edit").click();
  await dialog.getByTestId("group-edit-name").fill(names.renamed);
  await dialog.getByTestId("group-edit-sort").fill("4242");
  await dialog.getByTestId("group-edit-namemode").selectOption("2");
  await dialog.getByTestId("group-edit-save").click();
  await row(names.renamed).waitFor({ timeout: 10_000 });
  const renamed = await until(async () => {
    const g = await sgByName(names.renamed);
    return g && g.sortid === "4242" && g.namemode === "2" ? g : null;
  }, "ServerQuery sees the rename, sort id and name display");
  assert.equal(renamed.sgid, added.sgid, "the same group");

  // Copy.
  await row(names.renamed).getByTestId("group-copy").click();
  await dialog.getByTestId("group-copy-name").fill(names.copy);
  await dialog.getByTestId("group-copy-save").click();
  await row(names.copy).waitFor({ timeout: 10_000 });
  const copy = await until(() => sgByName(names.copy), "ServerQuery lists the copy");
  assert.equal(copy.sortid, "4242", "the copy keeps the sort id");
  await until(() => pushedHas("server", names.copy), "the page's own list has the copy");

  // Delete both (confirmed).
  for (const name of [names.copy, names.renamed]) {
    await row(name).getByTestId("group-delete").click();
    await confirm(page);
    await row(name).waitFor({ state: "detached", timeout: 10_000 });
    await until(async () => !(await sgByName(name)), `ServerQuery no longer lists ${name}`);
    // The server's next list leaves it out, and that list replaces the old one.
    await until(
      async () => !(await pushedHas("server", name)),
      `the page's own server groups drop ${name}`,
      10_000,
    );
  }

  // Channel groups: add, then delete.
  await dialog.getByTestId("groups-tab-channel").click();
  await dialog.getByTestId("group-new-name").fill(names.channel);
  await dialog.getByTestId("group-add").click();
  await row(names.channel).waitFor({ timeout: 10_000 });
  await until(
    async () => (await rig.sq.cmd("channelgrouplist")).some((g) => g.name === names.channel),
    "ServerQuery lists the channel group",
  );
  await until(
    () => pushedHas("channel", names.channel),
    "the page's own list has the channel group",
    10_000,
  );
  await row(names.channel).getByTestId("group-delete").click();
  await confirm(page);
  await row(names.channel).waitFor({ state: "detached", timeout: 10_000 });
  await until(
    async () => !(await pushedHas("channel", names.channel)),
    "the page's own channel groups drop the deleted one",
    10_000,
  );
  await closeDialog(page);
}

async function serverLog(admin, names) {
  const { page } = admin;
  await menu(page, serverRow(page), "Server log");
  const dialog = dialogOf(page, "log-dialog");
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByTestId("log-row").first().waitFor({ timeout: 10_000 });
  const total = await dialog.getByTestId("log-row").count();
  // TeamSpeak logs an edit as "server was edited by '<nick>'", without the fields.
  await dialog.getByTestId("log-search").fill(`server was edited by '${admin.nick}'`);
  await dialog.getByTestId("log-row").first().waitFor({ timeout: 10_000 });
  await dialog.getByTestId("log-search").fill(names.renamed);
  await dialog.getByTestId("log-row").first().waitFor({ timeout: 10_000 });
  const groupLines = await dialog.getByTestId("log-row").allInnerTexts();
  assert.ok(
    groupLines.some((l) => l.includes("was deleted")),
    `the group's deletion is logged: ${groupLines.join(" / ")}`,
  );
  // Level filter: nothing is left with every level off.
  await dialog.getByTestId("log-search").fill("");
  for (const level of ["critical", "error", "warning", "info", "debug", "unknown"]) {
    await dialog.getByTestId(`log-level-${level}`).uncheck();
  }
  assert.equal(await dialog.getByTestId("log-row").count(), 0, "every level filtered out");
  await closeDialog(page);
  return total;
}

async function connectionInfo(admin) {
  const { page } = admin;
  // Open the server's info afresh: the panel may have been showing it since
  // before the admin was an admin.
  await clientRow(page, admin.nick).first().click();
  await serverRow(page).click();
  const box = page.getByTestId("conn-info");
  await box.waitFor({ timeout: 10_000 });
  const packets = await until(async () => {
    const text = await box
      .getByTestId("conn-packets")
      .innerText()
      .catch(() => "");
    const nums = (text.match(/[\d,]+/g) ?? []).map((n) => Number(n.replace(/,/g, "")));
    return nums.length === 2 && nums.every((n) => n > 0) ? nums : null;
  }, "connection info shows packet counts");
  const totals = await box.getByTestId("conn-totals").innerText();
  assert.match(totals, /\d+(\.\d)? (B|KB|MB|GB|TB)/, `totals are sizes: ${totals}`);
  const ping = await box.getByTestId("conn-ping").innerText();
  assert.match(ping, /^\d+ ms$/, `ping is a number: ${ping}`);
  return { packets, totals, ping };
}

async function permOverview(admin, guest) {
  const { page } = admin;
  await menu(page, clientRow(page, guest.nick), "Permission overview");
  const dialog = dialogOf(page, "permov-dialog");
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByTestId("permov-search").fill("b_virtualserver_modify_name");
  const row = dialog.locator("[data-testid=permov-row][data-perm=b_virtualserver_modify_name]");
  await row.waitFor({ timeout: 15_000 });
  assert.equal((await row.getByTestId("permov-value").innerText()).trim(), "1");
  const sources = await row.getByTestId("permov-source").allInnerTexts();
  assert.ok(
    sources.some((s) => s.includes("Server group Server Admin") && s.includes("takes effect")),
    `Server Admin grants it: ${sources.join(" / ")}`,
  );
  await closeDialog(page);
}

/** The new windows as bottom sheets at phone width, with nothing wider than the screen. */
async function phoneWidth(rig, admin, guest) {
  const { page } = admin;
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator(".mshell").waitFor({ state: "visible", timeout: 10_000 });
  const fits = async (testId) => {
    const dialog = dialogOf(page, testId);
    await dialog.waitFor({ timeout: 10_000 });
    assert.match((await dialog.getAttribute("class")) ?? "", /\bsheet\b/, `${testId}: a sheet`);
    const overflow = await dialog.evaluate((el) => {
      const body = el.querySelector(".dialog-body");
      return {
        panel: el.scrollWidth - el.clientWidth,
        body: body ? body.scrollWidth - body.clientWidth : 0,
      };
    });
    assert.deepEqual(overflow, { panel: 0, body: 0 }, `${testId}: no sideways scrolling`);
    await page.screenshot({ path: rig.artifact(`m4-${testId}-phone.png`) });
  };
  /** `ready`: a row to wait for, so long lines are measured as well as the frame. */
  const open = async (row, label, testId, ready) => {
    await menu(page, row, label);
    if (ready) await page.getByTestId(ready).first().waitFor({ timeout: 15_000 });
    await fits(testId);
    await closeDialog(page);
  };
  await open(serverRow(page), "Use privilege key…", "pk-use-dialog");
  await open(serverRow(page), "Privilege keys", "pk-dialog");
  await menu(page, serverRow(page), "Privilege keys");
  await page.getByTestId("pk-new").click();
  await fits("pk-form");
  await closeDialog(page);
  await menu(page, serverRow(page), "Server and channel groups");
  const groupsDialog = dialogOf(page, "groups-dialog");
  await groupsDialog.getByTestId("group-edit").first().click();
  await fits("groups-dialog");
  await closeDialog(page);
  await open(serverRow(page), "Edit virtual server…", "srvedit-dialog");
  await open(serverRow(page), "Server log", "log-dialog", "log-row");
  await open(clientRow(page, guest.nick), "Permission overview", "permov-dialog", "permov-row");
}

export default async function m4ServerAdmin(rig) {
  const admin = await rig.connect("m4-admin", { channel: "a", admin: true });
  const guest = await rig.connect("m4-guest", { channel: "a" });
  const watcher = await rig.connect("m4-watch", { channel: "b" });
  // Reconnects through the connect dialog; a reload also resets the desktop
  // layout, so the watcher, whose tree the spec clicks, is not the one.
  const joiner = await rig.connect("m4-join", { channel: "b" });
  await rig.waitForClientInTree(admin.page, guest.nick);

  const [before] = await rig.sq.cmd("serverinfo");
  const original = {
    name: before.virtualserver_name,
    banner: before.virtualserver_hostbanner_gfx_url ?? "",
    logServer: before.virtualserver_log_server,
  };
  const newName = `${rig.prefix} m4 server`;
  const names = {
    server: `${rig.prefix}-m4g`,
    renamed: `${rig.prefix}-m4r`,
    copy: `${rig.prefix}-m4c`,
    channel: `${rig.prefix}-m4cg`,
  };
  try {
    await gating(guest);
    rig.log("gating ok");
    await redeemFromMenu(rig, guest);
    rig.log("privilege key from the server menu ok");
    await redeemFromConnectDialog(rig, joiner);
    rig.log("privilege key from the connect dialog ok");

    // The server's edits are only logged with this on; put back below.
    if (original.logServer !== "1") await rig.sq.cmd("serveredit", { virtualserver_log_server: 1 });
    await editServer(rig, admin, watcher, newName);
    rig.log(`renamed to "${newName}", banner set`);
    const bannerRequests = await bannerGate(watcher);
    rig.log(`banner gate ok (${bannerRequests} request(s) after the click, none before)`);

    await groups(rig, admin, names);
    rig.log("groups ok");
    const logRows = await serverLog(admin, names);
    rig.log(`server log ok (${logRows} rows on the first page)`);
    const conn = await connectionInfo(admin);
    rig.log(
      `connection info ok (packets ${conn.packets.join("/")}, totals ${conn.totals}, ping ${conn.ping})`,
    );
    await permOverview(admin, guest);
    rig.log("permission overview ok");
    await phoneWidth(rig, admin, guest);
    rig.log("phone width ok");
  } finally {
    await rig.sq
      .cmd("serveredit", {
        virtualserver_name: original.name,
        virtualserver_hostbanner_gfx_url: original.banner,
        virtualserver_log_server: original.logServer ?? "0",
      })
      .catch((err) => rig.log(`could not restore the server settings: ${err.message}`));
    for (const g of await sqList(rig, "servergrouplist")) {
      if (Object.values(names).includes(g.name)) {
        await rig.sq.cmd("servergroupdel", { sgid: g.sgid, force: 1 }).catch(() => undefined);
      }
    }
    for (const g of await sqList(rig, "channelgrouplist")) {
      if (g.name === names.channel) {
        await rig.sq.cmd("channelgroupdel", { cgid: g.cgid, force: 1 }).catch(() => undefined);
      }
    }
  }
  const [after] = await rig.sq.cmd("serverinfo");
  assert.equal(after.virtualserver_name, original.name, "the server's name is restored");
}
