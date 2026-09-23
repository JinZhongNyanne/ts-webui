/**
 * M2 admin tools, end to end against the live server: a complaint filed in
 * the UI shows up in the admin's complaint list and can be deleted (one, and
 * all about someone); an offline message sent to a disconnected user's UID is
 * waiting in their inbox (and announced) when they reconnect, and one sent
 * while they are online is picked up when they come back to the tab after a
 * while away (the server never pushes it); the client
 * database finds a rig client, edits its description and deletes an entry;
 * a temporary password is added with a target channel, a plain TS client
 * connecting with it lands there, and it is deleted; the windows fit a phone.
 *
 * Everything this creates is removed again: complaints and messages by the
 * spec itself, temporary passwords by the spec (and a ServerQuery sweep on
 * failure), client db entries by the rig's cleanup.
 */
import assert from "node:assert/strict";
import { Client, generateIdentity } from "@honeybbq/teamspeak-client";
import { until } from "../lib/rig.mjs";

export const title =
  "m2 admin tools: complaints, offline messages, client database, temporary passwords";

const escapeRe = (s) => s.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&");

const clientRow = (page, nick) =>
  page.locator(".tree .client").filter({
    has: page.locator(".nick", { hasText: new RegExp(`^\\s*${escapeRe(nick)}\\s*$`) }),
  });

const serverRow = (page) => page.locator(".tree .server-row").first();

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

const sqList = async (rig, line) =>
  rig.serverQuery(line).catch((err) => {
    if (err.id === 1281) return []; // database empty result set
    throw err;
  });

/* -------------------------------------------------------------- tests */

async function gating(rig, alice) {
  const labels = await menuLabels(alice.page, serverRow(alice.page));
  assert.ok(labels.includes("Offline messages"), "anyone may read their offline messages");
  for (const hidden of ["Complaints", "Client database", "Temporary passwords"]) {
    assert.ok(!labels.includes(hidden), `a guest is not offered ${hidden}: ${labels.join(", ")}`);
  }
  const clientLabels = await menuLabels(alice.page, clientRow(alice.page, rig.admin.nick));
  assert.ok(
    !clientLabels.includes("Send offline message…"),
    "a guest without b_client_offline_textmessage_send is not offered sending",
  );
}

async function complaints(rig, admin, alice, bob) {
  // bob (Normal, complain power 50) complains about alice (a guest, needs 0).
  const text = `m2 complaint ${rig.runId}`;
  await menu(bob.page, clientRow(bob.page, alice.nick), "Complain…");
  const dialog = dialogOf(bob.page, "complain-dialog");
  await dialog.locator("textarea").fill(text);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(
    async () =>
      (await sqList(rig, `complainlist tcldbid=${alice.dbId}`)).some((c) => c.message === text),
    "the server has bob's complaint",
  );
  // A second one about the same person is refused, and said so in words.
  await menu(bob.page, clientRow(bob.page, alice.nick), "Complain…");
  await dialog.locator("textarea").fill(`${text} again`);
  await dialog.locator("button[type=submit]").click();
  await dialog
    .locator(".note.error", { hasText: /already complained/ })
    .waitFor({ timeout: 10_000 });
  await closeDialog(bob.page);

  // The admin files one too, through the same menu.
  await menu(admin.page, clientRow(admin.page, alice.nick), "Complain…");
  const own = dialogOf(admin.page, "complain-dialog");
  await own.locator("textarea").fill(`${text} (admin)`);
  await own.locator("button[type=submit]").click();
  await own.waitFor({ state: "detached", timeout: 10_000 });

  // The admin's list groups both under alice; delete bob's, then all.
  await menu(admin.page, serverRow(admin.page), "Complaints");
  const list = dialogOf(admin.page, "complaints-dialog");
  const group = list
    .getByTestId("complaint-group")
    .filter({ has: admin.page.locator(".target", { hasText: alice.nick }) });
  await group.waitFor({ timeout: 10_000 });
  await until(async () => (await group.locator(".row").count()) === 2, "two complaints listed");
  const bobs = group.locator(".row").filter({ hasText: text }).filter({ hasText: bob.nick });
  await bobs.locator("button", { hasText: "Delete" }).click();
  await until(async () => (await group.locator(".row").count()) === 1, "bob's complaint gone");
  const left = await sqList(rig, `complainlist tcldbid=${alice.dbId}`);
  assert.deepEqual(
    left.map((c) => c.fcldbid),
    [admin.dbId],
    "the server has only the admin's complaint left",
  );
  await group.locator("button", { hasText: "Delete all" }).click();
  await confirm(admin.page);
  await group.waitFor({ state: "detached", timeout: 10_000 });
  assert.deepEqual(await sqList(rig, `complainlist tcldbid=${alice.dbId}`), []);
  await closeDialog(admin.page);
}

async function offlineMessages(rig, admin, carol) {
  const uid = await carol.page.evaluate(() => window.__jinzTs.self().uid);
  assert.ok(uid, "carol has a UID");
  // carol leaves: closing the page's socket ends her session.
  await carol.page.goto("about:blank");
  await until(
    async () => !(await rig.sq.cmd("clientlist")).some((c) => c.client_nickname === carol.nick),
    "carol is offline",
  );

  // The admin writes to her UID, found through the recipient picker's db search.
  const subject = `m2 offline ${rig.runId}`;
  const body = `Hello carol, ${rig.runId}`;
  await menu(admin.page, serverRow(admin.page), "Offline messages");
  const inbox = dialogOf(admin.page, "inbox-dialog");
  await inbox.locator("button", { hasText: "New message" }).click();
  const compose = admin.page.locator("[role=dialog][aria-modal=true]").filter({
    has: admin.page.getByTestId("compose-subject"),
  });
  await compose.getByTestId("recipient-search").fill(carol.nick);
  await compose.locator("button", { hasText: "Search" }).click();
  const hit = compose.locator(".row").filter({ hasText: uid });
  await hit.waitFor({ timeout: 10_000 });
  await hit.getByTestId("recipient-pick").click();
  assert.equal(await compose.getByTestId("compose-uid").inputValue(), uid);
  await compose.getByTestId("compose-subject").fill(subject);
  await compose.getByTestId("compose-message").fill(body);
  await compose.locator("button[type=submit]").click();
  // Opened from the inbox, so it goes back there.
  await inbox.waitFor({ timeout: 10_000 });
  await closeDialog(admin.page);

  // carol comes back with the same identity (same browser storage).
  await carol.page.goto(rig.webUrl, { waitUntil: "domcontentloaded" });
  await carol.page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
  await until(
    () => carol.page.evaluate(() => window.__jinzTs?.self?.() ?? null),
    "carol reconnects",
    45_000,
  );
  const events = () =>
    carol.page.evaluate(() =>
      window.__jinzTs
        .events()
        .map((e) => e.text)
        .join("\n"),
    );
  await until(
    async () => /Unread offline messages: 1\b/.test(await events()),
    "carol is told about her unread message in the server chat",
  );
  const labels = await menuLabels(carol.page, serverRow(carol.page));
  assert.ok(labels.includes("Offline messages (1 unread)"), `menu shows unread: ${labels}`);

  await menu(carol.page, serverRow(carol.page), "Offline messages (1 unread)");
  const hers = dialogOf(carol.page, "inbox-dialog");
  const row = hers.getByTestId("inbox-row").filter({ hasText: subject });
  await row.waitFor({ timeout: 10_000 });
  await until(async () => (await row.innerText()).includes(admin.nick), "the sender is named");
  // The row can show (from the list fetched on connect) while the window's
  // own refresh still waits its turn in the hub-wide command budget; a click
  // then is ignored, as for a person.
  await until(
    () => hers.locator("button", { hasText: "Refresh" }).isEnabled(),
    "the inbox finished loading",
  );
  await row.click();
  const opened = hers.getByTestId("inbox-message");
  await opened.locator(".body", { hasText: body }).waitFor({ timeout: 10_000 });
  // Reading marks it read on the server, so the title stops counting it.
  await until(
    async () => (await hers.locator("h3").innerText()).trim() === "Offline messages",
    "the unread count drops after reading",
  );
  await opened.locator("button", { hasText: "Delete" }).click();
  await confirm(carol.page);
  await opened.waitFor({ state: "detached", timeout: 10_000 });
  await hers.locator(".empty", { hasText: "No offline messages." }).waitFor({ timeout: 10_000 });
  await closeDialog(carol.page);

  await recheckOnReturn(rig, carol, uid, events);
}

/**
 * A message sent while carol is online: nothing arrives until she comes back
 * to the tab after a while away (faked: the page's clock jumps 11 minutes
 * while the tab is "hidden"), when the inbox is looked at again.
 */
async function recheckOnReturn(rig, carol, uid, events) {
  const subject = `m2 while online ${rig.runId}`;
  const announced = async () =>
    (await events()).match(/Unread offline messages: 1\b/g)?.length ?? 0;
  const before = await announced();
  await rig.sq.cmd("messageadd", { cluid: uid, subject, message: "hi" });
  await carol.page.evaluate(() => {
    let state = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    const flip = (next) => {
      state = next;
      document.dispatchEvent(new Event("visibilitychange"));
    };
    flip("hidden");
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + 11 * 60_000;
    flip("visible");
  });
  await until(async () => (await announced()) > before, "the new message is announced");
  const labels = await menuLabels(carol.page, serverRow(carol.page));
  assert.ok(labels.includes("Offline messages (1 unread)"), `menu shows unread: ${labels}`);

  // Delete it again (it is ours).
  await menu(carol.page, serverRow(carol.page), "Offline messages (1 unread)");
  const hers = dialogOf(carol.page, "inbox-dialog");
  const row = hers.getByTestId("inbox-row").filter({ hasText: subject });
  await row.waitFor({ timeout: 10_000 });
  await until(
    () => hers.locator("button", { hasText: "Refresh" }).isEnabled(),
    "the inbox finished loading",
  );
  await row.click();
  const opened = hers.getByTestId("inbox-message");
  await opened.locator("button", { hasText: "Delete" }).click();
  await confirm(carol.page);
  await hers.locator(".empty", { hasText: "No offline messages." }).waitFor({ timeout: 10_000 });
  await closeDialog(carol.page);
}

async function clientDatabase(rig, admin, alice, carol) {
  await menu(admin.page, serverRow(admin.page), "Client database");
  const db = dialogOf(admin.page, "clientdb-dialog");
  // The first page comes with the total.
  await db.locator(".pager", { hasText: /Page 1 of \d+/ }).waitFor({ timeout: 10_000 });

  await db.getByTestId("clientdb-search").fill(alice.nick);
  await db.getByTestId("clientdb-search").press("Enter");
  const row = db.getByTestId("clientdb-row").filter({ hasText: alice.nick });
  await row.waitFor({ timeout: 10_000 });
  assert.equal(await db.getByTestId("clientdb-row").count(), 1, "the search finds just alice");
  await row.click();
  const details = admin.page.getByTestId("clientdb-details");
  const aliceUid = await alice.page.evaluate(() => window.__jinzTs.self().uid);
  await details.locator("dd", { hasText: aliceUid }).waitFor({ timeout: 5_000 });

  const desc = `m2 db ${rig.runId}`;
  await details.getByTestId("clientdb-description").fill(desc);
  await details.locator("button", { hasText: "Save" }).click();
  await until(
    async () =>
      (await rig.sq.cmd("clientdbinfo", { cldbid: alice.dbId }))[0]?.client_description === desc,
    "the server has alice's new description",
  );
  await details.locator("button", { hasText: "Back" }).click();

  // Delete carol's entry (made by this run) once she is offline again.
  await carol.page.goto("about:blank");
  await until(
    async () => !(await rig.sq.cmd("clientlist")).some((c) => c.client_nickname === carol.nick),
    "carol is offline again",
  );
  await db.getByTestId("clientdb-search").fill(carol.nick);
  await db.getByTestId("clientdb-search").press("Enter");
  const carolRow = db.getByTestId("clientdb-row").filter({ hasText: carol.nick });
  await carolRow.waitFor({ timeout: 10_000 });
  await carolRow.click();
  await details.locator("button", { hasText: "Delete this client" }).click();
  await confirm(admin.page);
  await details.waitFor({ state: "detached", timeout: 10_000 });
  const gone = await rig.sq
    .cmd("clientdbfind", { pattern: carol.nick })
    .catch((err) => (err.id === 1281 ? [] : Promise.reject(err)));
  assert.deepEqual(gone, [], "carol's entry is gone from the database");
  rig.dbIds.delete(carol.dbId);
  await closeDialog(admin.page);
}

/**
 * A plain TeamSpeak client connects with the temporary password as its server
 * password and lands in the password's channel. (The test server has no
 * server password of its own, but it still honours a temporary one's channel.)
 */
async function connectWithTempPassword(rig, pw) {
  const nick = `${rig.prefix}-tpw`;
  const quiet = () => undefined;
  const client = new Client(
    generateIdentity(8),
    `${rig.config.tsHost}:${rig.config.tsPort}`,
    nick,
    {
      logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
      serverPassword: pw,
    },
  );
  try {
    await client.connect();
    await client.waitConnected(AbortSignal.timeout(15_000));
    const rec = await until(
      async () => (await rig.sq.cmd("clientlist")).find((c) => c.client_nickname === nick),
      "the temporary password client is online",
    );
    rig.dbIds.add(rec.client_database_id);
    assert.equal(rec.cid, String(rig.channels.b), "it lands in the password's channel");
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

async function tempPasswords(rig, admin) {
  const pw = `m2pw-${rig.runId}`;
  try {
    await menu(admin.page, serverRow(admin.page), "Temporary passwords");
    const win = dialogOf(admin.page, "temppw-dialog");
    await win.getByTestId("temppw-new").click();
    const form = admin.page.getByTestId("temppw-form");
    await form.getByTestId("temppw-password").fill(pw);
    await form.getByTestId("temppw-desc").fill(`e2e ${rig.runId}`);
    await form.getByTestId("temppw-duration").selectOption({ label: "3 hours" });
    await form
      .getByTestId("temppw-channel")
      .selectOption({ label: `${rig.prefix} / ${rig.channels.name("b")}` });
    await form.locator("button[type=submit]").click();
    const row = admin.page.getByTestId("temppw-row").filter({ hasText: pw });
    await row.waitFor({ timeout: 10_000 });

    const listed = (await sqList(rig, "servertemppasswordlist")).find((p) => p.pw_clear === pw);
    assert.ok(listed, "the server lists the new password");
    const hours = (Number(listed.end) - Number(listed.start)) / 3600;
    assert.equal(hours, 3, "with the chosen duration");
    assert.equal(listed.tcid, String(rig.channels.b), "and the chosen channel");

    await connectWithTempPassword(rig, pw);

    await row.locator("button", { hasText: "Delete" }).click();
    await confirm(admin.page);
    await row.waitFor({ state: "detached", timeout: 10_000 });
    const after = await sqList(rig, "servertemppasswordlist");
    assert.ok(!after.some((p) => p.pw_clear === pw), "the password is deleted on the server");
    await closeDialog(admin.page);
  } finally {
    await rig.sq.cmd("servertemppassworddel", { pw }).catch(() => undefined);
  }
}

/** The admin windows as bottom sheets at phone width, with nothing wider than the screen. */
async function phoneWidth(rig, admin) {
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
    await page.screenshot({ path: rig.artifact(`m2-${testId}-phone.png`) });
  };
  const open = async (label, testId) => {
    await menu(page, serverRow(page), label);
    await fits(testId);
  };
  await open("Client database", "clientdb-dialog");
  await dialogOf(page, "clientdb-dialog").getByTestId("clientdb-row").first().click();
  await fits("clientdb-details");
  await closeDialog(page);
  await open("Temporary passwords", "temppw-dialog");
  await page.getByTestId("temppw-new").click();
  await fits("temppw-form");
  await closeDialog(page);
  await open("Complaints", "complaints-dialog");
  await closeDialog(page);
  await open("Offline messages", "inbox-dialog");
  await closeDialog(page);
}

export default async function m2AdminTools(rig) {
  const admin = await rig.connect("adm-admin", { channel: "a", admin: true });
  const alice = await rig.connect("adm-alice", { channel: "a" });
  const bob = await rig.connect("adm-bob", { channel: "a" });
  const carol = await rig.connect("adm-carol", { channel: "b" });
  rig.admin = admin;

  // bob gets the stock "Normal" group, whose complain power a guest lacks.
  const groups = await rig.sq.cmd("servergrouplist");
  const normal = groups.find((g) => g.name === "Normal" && g.type === "1");
  assert.ok(normal, "the server has a Normal group");
  await rig.sq.cmd("servergroupaddclient", { sgid: normal.sgid, cldbid: bob.dbId });
  await until(
    () =>
      bob.page.evaluate(
        (sgid) => window.__jinzTs.self()?.serverGroups?.includes(sgid) ?? false,
        normal.sgid,
      ),
    "bob sees himself in Normal",
  );
  await rig.waitForClientInTree(admin.page, alice.nick);
  await rig.waitForClientInTree(bob.page, alice.nick);

  try {
    await gating(rig, alice);
    rig.log("gating ok");
    await complaints(rig, admin, alice, bob);
    rig.log("complaints ok");
    await offlineMessages(rig, admin, carol);
    rig.log("offline messages ok");
    await clientDatabase(rig, admin, alice, carol);
    rig.log("client database ok");
    await tempPasswords(rig, admin);
    rig.log("temporary passwords ok");
    await phoneWidth(rig, admin);
    rig.log("phone width ok");
  } finally {
    await rig.serverQuery(`complaindelall tcldbid=${alice.dbId}`).catch(() => undefined);
  }
}
