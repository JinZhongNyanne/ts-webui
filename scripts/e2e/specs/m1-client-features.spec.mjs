/**
 * M1 client features, end to end against the live server: change nickname
 * while connected (and the server's "in use" answer), away with a message and
 * presets, avatars (uploaded by a plain TeamSpeak client, shown in the tree,
 * the info panel and chat), client descriptions, talk power requests in a
 * channel that needs talk power (grant / revoke by an admin), and per-channel
 * subscriptions including subscribe-on-connect switched off.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { crc32, deflateSync } from "node:zlib";
import { Client, generateIdentity } from "@honeybbq/teamspeak-client";
import { until } from "../lib/rig.mjs";

export const title =
  "m1 client features: nickname, away, avatar, description, talk power, subscriptions";

/** A 2×2 red PNG, built here so the test does not hinge on a pasted blob. */
function tinyPng() {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // width
  ihdr.writeUInt32BE(2, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  // Two rows, each: filter byte 0 then two red pixels.
  const row = Buffer.from([0, 255, 0, 0, 255, 0, 0]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat([row, row]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const AVATAR_PNG = tinyPng();

/** TS3 names avatar files after the UID's bytes in a–p hex (see apps/hub/src/gateway/avatar.ts). */
const avatarPath = (uid) =>
  "/avatar_" +
  [...Buffer.from(uid, "base64")]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
    .join("");

const clientRow = (page, nick) =>
  page.locator(".tree .client").filter({
    has: page.locator(".nick", {
      hasText: new RegExp(`^\\s*${nick.replace(/[-.]/g, "\\$&")}\\s*$`),
    }),
  });

const channelRow = (page, name) =>
  page.locator(".tree .channel").filter({
    has: page.locator(".channel-name", {
      hasText: new RegExp(`^${name.replace(/[-.]/g, "\\$&")}$`),
    }),
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

/** The dialog holding the field marked `testId` (AppDialog itself renders through a teleport). */
const dialogOf = (page, testId) =>
  page.locator("[role=dialog][aria-modal=true]").filter({ has: page.getByTestId(testId) });

const clientInfo = async (rig, clid) => (await rig.sq.cmd("clientinfo", { clid }))[0];

async function nickname(rig, alice, admin) {
  const { page } = alice;
  await page.getByTestId("status-nickname").click();
  const dialog = dialogOf(page, "nickname-dialog");
  const input = dialog.locator("input");
  // Taken: the server's answer lands under the field.
  await input.fill(admin.nick);
  await input.press("Enter");
  await dialog.locator(".note.error", { hasText: /already in use/i }).waitFor({ timeout: 10_000 });
  // Too short, caught before anything is sent.
  await input.fill(" ab ");
  await input.press("Enter");
  await dialog.locator(".note.error", { hasText: /at least 3/i }).waitFor({ timeout: 5_000 });
  const renamed = `${rig.prefix}-alice2`;
  await input.fill(renamed);
  await input.press("Enter");
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(
    async () => (await clientInfo(rig, alice.clid)).client_nickname === renamed,
    "the server has the new nickname",
  );
  await rig.waitForClientInTree(admin.page, renamed);
  alice.nick = renamed;
}

async function away(rig, alice, admin) {
  const { page } = alice;
  await page.getByTestId("status-away").click();
  const dialog = dialogOf(page, "away-dialog");
  const input = dialog.locator("input");
  await dialog.locator(".preset .pick", { hasText: "Having lunch" }).click();
  assert.equal(await input.inputValue(), "Having lunch", "a preset fills the field");
  const text = `m1cf away ${rig.runId}`;
  await input.fill(text);
  await dialog.locator("button.keep").click();
  await dialog.locator(".preset .pick", { hasText: text }).waitFor({ timeout: 3_000 });
  await dialog.locator(".preset .drop").filter({ hasText: "×" }).last().click(); // drops "Sleeping"
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("jinz.away.presets")));
  assert.equal(saved[0], text, "the new preset is saved first");
  assert.ok(!saved.includes("Sleeping"), "a removed preset is gone");
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });

  await until(async () => {
    const info = await clientInfo(rig, alice.clid);
    return info.client_away === "1" && info.client_away_message === text;
  }, "the server has alice away with the message");
  const row = clientRow(admin.page, alice.nick);
  await until(
    async () => ((await row.getAttribute("title")) ?? "").includes(text),
    "the admin's tree tooltip shows the away message",
  );
  await row.click();
  await admin.page.locator(".info .rich", { hasText: text }).waitFor({ timeout: 5_000 });

  // Back is one click, and clears the message.
  await page.getByTestId("status-away").click();
  await until(async () => {
    const info = await clientInfo(rig, alice.clid);
    return info.client_away === "0" && info.client_away_message === "";
  }, "the server has alice back");
}

/** A plain TeamSpeak client that uploads an avatar, as a native client would. */
async function avatarUploader(rig) {
  const nick = `${rig.prefix}-av`;
  const quiet = () => undefined;
  const client = new Client(
    generateIdentity(8),
    `${rig.config.tsHost}:${rig.config.tsPort}`,
    nick,
    {
      logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
      ...(rig.config.tsPassword ? { serverPassword: rig.config.tsPassword } : {}),
    },
  );
  await client.connect();
  await client.waitConnected(AbortSignal.timeout(15_000));
  const rec = await until(
    async () =>
      (await rig.sq.cmd("clientlist", {}, ["uid"])).find((c) => c.client_nickname === nick),
    "the avatar client is online",
  );
  // Deleting the database entry on cleanup also deletes its avatar file.
  rig.dbIds.add(rec.client_database_id);
  await client.execCommand(`clientmove clid=${client.clientID()} cid=${rig.channels.a}`, 10_000);
  const upload = await client.fileTransferInitUpload(
    0n,
    avatarPath(rec.client_unique_identifier),
    "",
    BigInt(AVATAR_PNG.length),
    true,
  );
  await client.uploadFileData(rig.config.tsHost, upload, Readable.from([AVATAR_PNG]));
  const md5 = createHash("md5").update(AVATAR_PNG).digest("hex");
  await client.execCommand(`clientupdate client_flag_avatar=${md5}`, 10_000);
  return { client, nick };
}

const loadedAvatar = (scope) =>
  scope
    .locator("img[data-testid=client-avatar]")
    .evaluateAll((imgs) => imgs.some((i) => i.complete && i.naturalWidth === 2));

async function avatars(rig, alice, admin) {
  const bot = await avatarUploader(rig);
  try {
    const { page } = admin;
    const row = clientRow(page, bot.nick);
    await row.waitFor({ timeout: 15_000 });
    await until(() => loadedAvatar(row), "the avatar loads in the tree");
    await row.click();
    await until(() => loadedAvatar(page.locator(".info .head")), "and in the info panel");

    // Chat: the avatar sits next to the sender's name.
    const channel = rig.channels.name("a");
    const text = `avatar hello ${rig.runId}`;
    await bot.client.execCommand(
      `sendtextmessage targetmode=2 target=0 msg=${text.replace(/ /g, "\\s")}`,
      10_000,
    );
    const line = await rig.waitForChatMessage(alice, text, channel, bot.nick);
    await until(() => loadedAvatar(line), "the avatar shows in chat");
    await page.screenshot({ path: rig.artifact("m1-avatar-admin.png") });
    await alice.page.screenshot({ path: rig.artifact("m1-avatar-chat.png") });

    // The tree setting hides them there only.
    await menu(page, page.locator(".tree .server-row"), "Show avatars in the channel tree");
    await until(
      async () => (await row.locator("img[data-testid=client-avatar]").count()) === 0,
      "hidden in the tree",
    );
    assert.ok(await loadedAvatar(page.locator(".info .head")), "still in the info panel");
    await menu(page, page.locator(".tree .server-row"), "Show avatars in the channel tree");
    await until(() => loadedAvatar(row), "back in the tree");

    // Removing the avatar removes the image.
    await bot.client.execCommand("clientupdate client_flag_avatar=", 10_000);
    await until(
      async () => (await row.locator("img[data-testid=client-avatar]").count()) === 0,
      "a removed avatar disappears",
    );
  } finally {
    await bot.client.disconnect().catch(() => undefined);
  }
}

/** Whether the page's perms store holds `perm` (see useClientMenus.ts for why that is the rule). */
const granted = (page, perm) =>
  page.evaluate(async (name) => {
    const { usePermsStore } = await import("/src/stores/perms.ts");
    return usePermsStore().has(name);
  }, perm);

/** Opens the description dialog from `row`'s menu, saves `text`, waits for it to close. */
async function editDescription(page, row, text) {
  await menu(page, row, "Edit description…");
  const dialog = dialogOf(page, "description-dialog");
  await dialog.locator("textarea").fill(text);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
}

async function descriptions(rig, alice, admin) {
  // The menu follows the permissions the server reported.
  const aliceOwn = await granted(alice.page, "b_client_modify_own_description");
  const aliceSelfMenu = await menuLabels(alice.page, clientRow(alice.page, alice.nick));
  assert.equal(aliceSelfMenu.includes("Edit description…"), aliceOwn, "own edit follows the perm");
  const aliceOthers = await granted(alice.page, "b_client_modify_description");
  const aliceOnAdmin = await menuLabels(alice.page, clientRow(alice.page, admin.nick));
  assert.equal(
    aliceOnAdmin.includes("Edit description…"),
    aliceOthers,
    "others' edit follows the perm",
  );
  rig.log(`normal user may edit: own ${aliceOwn}, others ${aliceOthers}`);

  // An admin edits their own, then alice's.
  const own = `admin's own ${rig.runId}`;
  await editDescription(admin.page, clientRow(admin.page, admin.nick), own);
  await until(
    async () => (await clientInfo(rig, admin.clid)).client_description === own,
    "the server has the admin's own description",
  );
  const text = `set by admin ${rig.runId}`;
  await editDescription(admin.page, clientRow(admin.page, alice.nick), text);
  await until(
    async () => (await clientInfo(rig, alice.clid)).client_description === text,
    "the server has the description the admin set for alice",
  );
  await clientRow(alice.page, alice.nick).click();
  await alice.page
    .getByTestId("info-description")
    .locator(".rich", { hasText: text })
    .waitFor({ timeout: 10_000 });

  // Where the menu would not offer it, the server refuses, naming the permission.
  if (!aliceOthers) {
    const message = await alice.page.evaluate(async (clid) => {
      const { setDescription } = await import("/src/ts/client-actions.ts");
      return setDescription(clid, "nope").then(
        () => "accepted",
        (err) => err.message,
      );
    }, Number(admin.clid));
    // Translated, with the permission the server checked (on a stock TS3 server
    // that is b_client_modify_own_description, oddly, even for someone else's).
    assert.match(message, /^Insufficient permissions \(needs b_client_modify_\w+\)$/, message);
  }
}

async function talkPower(rig, alice, admin, talkCid, talkName) {
  const { page } = alice;
  assert.equal(
    await page.getByTestId("status-talk-request").count(),
    0,
    "no request button where none is needed",
  );
  await channelRow(page, talkName).dblclick();
  await until(
    async () => (await clientInfo(rig, alice.clid)).cid === talkCid,
    "alice is in the talk channel",
  );

  const button = page.getByTestId("status-talk-request");
  await button.waitFor({ timeout: 10_000 });
  await button.click();
  const dialog = dialogOf(page, "talk-request-dialog");
  const reason = `m1cf please ${rig.runId}`.slice(0, 50);
  await dialog.locator("input").fill(reason);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });

  const row = clientRow(admin.page, alice.nick);
  const marker = row.getByTestId("talk-request-marker");
  await marker.waitFor({ timeout: 10_000 });
  assert.match((await marker.getAttribute("title")) ?? "", new RegExp(reason));
  await row.click(); // the info panel shows the request and a grant button
  await admin.page.getByTestId("info-talk-request").waitFor({ timeout: 5_000 });
  await admin.page.screenshot({ path: rig.artifact("m1-talk-request-admin.png") });
  await page.screenshot({ path: rig.artifact("m1-talk-request-alice.png") });

  await menu(admin.page, row, "Grant talk power");
  await until(
    async () => (await clientInfo(rig, alice.clid)).client_is_talker === "1",
    "alice is a talker",
  );
  await until(
    async () => (await page.getByTestId("status-talk-request").count()) === 0,
    "alice's request button goes away",
  );

  await menu(admin.page, row, "Revoke talk power");
  await until(
    async () => (await clientInfo(rig, alice.clid)).client_is_talker === "0",
    "talker revoked",
  );

  // Request again, then take it back.
  await button.waitFor({ timeout: 10_000 });
  await button.click();
  await dialog.locator("button[type=submit]").click();
  await marker.waitFor({ timeout: 10_000 });
  await page.getByTestId("status-talk-request").click(); // now "cancel"
  await marker.waitFor({ state: "detached", timeout: 10_000 });
  assert.equal((await clientInfo(rig, alice.clid)).client_talk_request, "0");
}

async function subscriptions(rig, admin, bob) {
  const { page } = admin;
  const b = rig.channels.name("b");
  await rig.waitForClientInTree(page, bob.nick);

  await menu(page, channelRow(page, b), "Unsubscribe from channel");
  await clientRow(page, bob.nick).waitFor({ state: "detached", timeout: 10_000 });
  assert.match((await channelRow(page, b).getAttribute("class")) ?? "", /\bunsubscribed\b/);

  await menu(page, channelRow(page, b), "Subscribe to channel");
  await rig.waitForClientInTree(page, bob.nick);
  assert.doesNotMatch((await channelRow(page, b).getAttribute("class")) ?? "", /\bunsubscribed\b/);

  await menu(page, page.locator(".tree .server-row"), "Unsubscribe from all channels");
  await clientRow(page, bob.nick).waitFor({ state: "detached", timeout: 10_000 });
  // Our own channel keeps reporting its members.
  const own = rig.channels.name("a");
  assert.doesNotMatch(
    (await channelRow(page, own).getAttribute("class")) ?? "",
    /\bunsubscribed\b/,
  );
  await menu(page, page.locator(".tree .server-row"), "Subscribe to all channels");
  await rig.waitForClientInTree(page, bob.nick);
}

async function subscribeOnConnectOff(rig, bob) {
  const carol = await rig.connect("carol", { channel: "a" });
  const { page } = carol;
  await rig.waitForClientInTree(page, bob.nick);
  await menu(page, page.locator(".tree .server-row"), "Subscribe to all channels on connect");
  assert.equal(await page.evaluate(() => localStorage.getItem("jinz.subscribeAll")), "0");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
  await rig.waitForClientInTree(page, carol.nick);
  const b = rig.channels.name("b");
  await channelRow(page, b).waitFor({ timeout: 10_000 });
  await until(
    async () => /\bunsubscribed\b/.test((await channelRow(page, b).getAttribute("class")) ?? ""),
    "channel b starts unsubscribed",
  );
  assert.equal(await clientRow(page, bob.nick).count(), 0, "bob (in b) is not reported");
  // Subscribing that one channel brings its members in.
  await menu(page, channelRow(page, b), "Subscribe to channel");
  await rig.waitForClientInTree(page, bob.nick);
  return carol;
}

/** Phone width: the menu sheet opens the same dialogs, as bottom sheets. */
async function mobile(rig, carol) {
  const { page } = carol;
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator(".mshell").waitFor({ state: "visible", timeout: 10_000 });
  await page.locator("button.more").click();
  await page.locator("button", { hasText: "Change nickname" }).click();
  const dialog = dialogOf(page, "nickname-dialog");
  await dialog.waitFor({ timeout: 5_000 });
  assert.match((await dialog.getAttribute("class")) ?? "", /\bsheet\b/, "a bottom sheet");
  await page.screenshot({ path: rig.artifact("m1-nickname-sheet.png") });
  const renamed = `${rig.prefix}-carol2`;
  await dialog.locator("input").fill(renamed);
  await dialog.locator("input").press("Enter");
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  // Carol reconnected after the reload, so her clid changed; find her by name.
  await until(
    async () => (await rig.sq.cmd("clientlist")).some((c) => c.client_nickname === renamed),
    "renamed from the phone layout",
  );
}

export default async function m1ClientFeatures(rig) {
  const talkName = `${rig.prefix}-talk`;
  const [rec] = await rig.sq.cmd("channelcreate", {
    channel_name: talkName,
    cpid: rig.channels.root,
    channel_flag_semi_permanent: 1,
    channel_needed_talk_power: 10,
  });
  const talkCid = rec.cid;
  try {
    const alice = await rig.connect("alice", { channel: "a" });
    const admin = await rig.connect("admin", { channel: "a", admin: true });
    const bob = await rig.connect("bob", { channel: "b" });
    await rig.waitForClientInTree(admin.page, alice.nick);

    await nickname(rig, alice, admin);
    rig.log("nickname ok");
    await away(rig, alice, admin);
    rig.log("away ok");
    await avatars(rig, alice, admin);
    rig.log("avatars ok");
    await descriptions(rig, alice, admin);
    rig.log("descriptions ok");
    await talkPower(rig, alice, admin, talkCid, talkName);
    rig.log("talk power ok");
    await subscriptions(rig, admin, bob);
    rig.log("subscriptions ok");
    const carol = await subscribeOnConnectOff(rig, bob);
    rig.log("subscribe-on-connect off ok");
    await mobile(rig, carol);
    rig.log("phone layout ok");
  } finally {
    await rig.sq.cmd("channeldelete", { cid: talkCid, force: 1 }).catch(() => undefined);
  }
}
