/**
 * M3 avatars and icons, end to end against the live server.
 *
 * Avatar: a guest picks an image in Settings → Profile, crops it and uploads
 * it; ServerQuery sees client_flag_avatar set to the file's MD5, another web
 * client sees it in the tree, and a plain TeamSpeak client (the protocol
 * library, as a native client would) downloads the same bytes from the
 * avatar path. Removing it clears the flag for everyone.
 *
 * Icons: a Server Admin uploads a 16×16 PNG in the icon manager (its id is
 * the CRC-32 of the bytes) and a bigger one (scaled down), then sets the
 * first on a throwaway server group (from the server groups dialog), a
 * channel and a client (context menus); the other client sees each one and
 * sees it go again when removed; the icons are deleted. A guest is not
 * offered the manager.
 *
 * Everything made here (the group, icon files, permissions) is removed at
 * the end; the rig deletes the identities (their avatars go with them).
 */
import assert from "node:assert/strict";
import { createHash, randomInt } from "node:crypto";
import { Writable } from "node:stream";
import { crc32, deflateSync } from "node:zlib";
import { Client, generateIdentity, getClientInfo } from "@honeybbq/teamspeak-client";
import { until } from "../lib/rig.mjs";

export const title = "m3 avatar & icons: upload, crop, assign, everyone sees it, removal";

/** An RGB PNG of `w`×`h` coloured by `rgb(x, y)`, built here rather than pasted. */
function png(w, h, rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0]; // filter: none
    for (let x = 0; x < w; x++) row.push(...rgb(x, y));
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const md5 = (buf) => createHash("md5").update(buf).digest("hex");

/** TS3 names avatar files after the UID's bytes in a–p hex (see ts-internal-files.ts). */
const avatarPath = (uid) =>
  "/avatar_" +
  [...Buffer.from(uid, "base64")]
    .map((b) => String.fromCharCode(97 + (b >> 4), 97 + (b & 15)))
    .join("");

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

async function confirm(page) {
  const box = page
    .locator("[role=dialog][aria-modal=true]")
    .filter({ has: page.locator("button.danger") });
  await box.locator("button.danger").click();
}

/** Whether `scope` holds a loaded image whose URL matches `re`. */
const loadedImg = (scope, selector, re) =>
  scope
    .locator(selector)
    .evaluateAll(
      (imgs, src) =>
        imgs.some((i) => new RegExp(src).test(i.src) && i.complete && i.naturalWidth > 0),
      re.source,
    );

const sqRows = async (rig, line) => {
  try {
    return await rig.serverQuery(line);
  } catch (err) {
    if (err.id === 1281) return []; // empty result set
    throw err;
  }
};

const iconFiles = async (rig) =>
  (await sqRows(rig, "ftgetfilelist cid=0 cpw= path=\\/icons")).map((r) => r.name);

/** A plain TeamSpeak client, to see what native clients see. */
async function nativeClient(rig) {
  const quiet = () => undefined;
  const nick = `${rig.prefix}-native`;
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
    async () => (await rig.sq.cmd("clientlist")).find((c) => c.client_nickname === nick),
    "the native client is online",
  );
  rig.dbIds.add(rec.client_database_id);
  return client;
}

async function download(client, host, path) {
  const info = await client.fileTransferInitDownload(0n, path, "");
  const chunks = [];
  await client.downloadFileData(
    host,
    info,
    new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    }),
  );
  return Buffer.concat(chunks);
}

async function openProfile(page) {
  await page.getByTestId("status-settings").click();
  await page.getByTestId("settings-tab-profile").click();
  await page.getByTestId("ts-avatar").waitFor({ state: "visible", timeout: 5_000 });
}

async function avatar(rig, alice, bob) {
  const { page } = alice;
  await openProfile(page);
  // Wide, so the square crop has something to cut: red left half, blue right.
  const image = png(160, 90, (x) => (x < 80 ? [220, 30, 30] : [30, 60, 220]));
  await page.getByTestId("ts-avatar-input").setInputFiles({
    name: "me.png",
    mimeType: "image/png",
    buffer: image,
  });
  const crop = page.getByTestId("avatar-crop");
  await crop.waitFor({ state: "visible", timeout: 5_000 });
  // Drag right a little and zoom in, like a user framing the picture.
  const box = await crop.locator(".box").boundingBox();
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + 120, { steps: 5 });
  await page.mouse.up();
  await page.getByTestId("avatar-zoom").fill("1.5");
  await page.getByTestId("avatar-save").click();
  await crop.waitFor({ state: "detached", timeout: 20_000 });

  const flag = await until(async () => {
    const [info] = await rig.sq.cmd("clientinfo", { clid: alice.clid });
    return /^[0-9a-f]{32}$/.test(info.client_flag_avatar) ? info.client_flag_avatar : null;
  }, "ServerQuery sees client_flag_avatar as an MD5");
  await until(
    () => loadedImg(page.getByTestId("ts-avatar"), "img", /\/avatar\//),
    "the Profile pane shows the new avatar",
  );
  await until(
    () => loadedImg(clientRow(bob.page, alice.nick), "img[data-testid=client-avatar]", /avatar/),
    "the other web client sees it in the tree",
  );
  await page.screenshot({ path: rig.artifact("m3-avatar-profile.png") });

  // A native client finds the same bytes under the UID-derived name.
  const native = await nativeClient(rig);
  try {
    const raw = await getClientInfo(native, Number(alice.clid));
    assert.equal(raw.client_flag_avatar, flag, "the native client sees the flag");
    const [info] = await rig.sq.cmd("clientinfo", { clid: alice.clid });
    const bytes = await download(
      native,
      rig.config.tsHost,
      avatarPath(info.client_unique_identifier),
    );
    assert.equal(md5(bytes), flag, "the file's MD5 is the flag");
    assert.equal(bytes.subarray(1, 4).toString(), "PNG", "saved as PNG (it fits the limit)");
    // 90 px high, zoomed 1.5×: a 60 px square of source pixels, kept at that size.
    assert.equal(bytes.readUInt32BE(16), 60, "a square of the crop's own size");
    assert.equal(bytes.readUInt32BE(20), 60);
  } finally {
    await native.disconnect().catch(() => undefined);
  }

  // A replacement is a new hash, which the hub has not cached: everyone sees it at once.
  await page.getByTestId("ts-avatar-input").setInputFiles({
    name: "again.png",
    mimeType: "image/png",
    buffer: png(40, 40, () => [20, 200, 60]),
  });
  await crop.waitFor({ state: "visible", timeout: 5_000 });
  await page.getByTestId("avatar-save").click();
  await crop.waitFor({ state: "detached", timeout: 20_000 });
  const flag2 = await until(async () => {
    const [info] = await rig.sq.cmd("clientinfo", { clid: alice.clid });
    return info.client_flag_avatar && info.client_flag_avatar !== flag
      ? info.client_flag_avatar
      : null;
  }, "the replacement gets a new flag");
  await until(
    () =>
      loadedImg(
        clientRow(bob.page, alice.nick),
        "img[data-testid=client-avatar]",
        new RegExp(`/avatar/${flag2}$`),
      ),
    "the other client sees the replacement",
  );

  // Removing it clears the flag everywhere.
  await page.getByTestId("ts-avatar-remove").click();
  await confirm(page);
  await until(async () => {
    const [info] = await rig.sq.cmd("clientinfo", { clid: alice.clid });
    return !info.client_flag_avatar;
  }, "the flag is cleared");
  await until(
    async () =>
      (await clientRow(bob.page, alice.nick).locator("img[data-testid=client-avatar]").count()) ===
      0,
    "the avatar disappears for the other client",
  );
  await page.keyboard.press("Escape");
}

async function openManager(page) {
  await menu(page, page.locator(".tree .server-row"), "Icons…");
  await page.getByTestId("icon-manager").waitFor({ state: "visible", timeout: 5_000 });
}

/** Picks icon `id` in the open picker (it closes once the server agreed). */
async function pick(page, id) {
  const manager = page.getByTestId("icon-manager");
  const tile =
    id === null
      ? manager.getByTestId("icon-none")
      : manager.locator(`[data-icon-id="${id}"] button.tile`);
  await tile.click();
  await manager.waitFor({ state: "detached", timeout: 10_000 });
}

async function icons(rig, admin, bob, alice) {
  const { page } = admin;
  // Unique per run, so no other run's (or anyone's) icon is touched; and an
  // id above 2^31, which permissions carry as a negative int32.
  let run;
  let icon;
  do {
    run = randomInt(1 << 24);
    icon = png(16, 16, (x, y) => [(x * 16 + run) & 255, (y * 16) & 255, (run >> 8) & 255]);
  } while (crc32(icon) >>> 0 < 2 ** 31);
  const iconId = crc32(icon) >>> 0;
  const big = png(48, 32, (x, y) => [(x + run) & 255, (run >> 16) & 255, y * 7]);
  const [{ sgid }] = await rig.sq.cmd("servergroupadd", { name: `${rig.prefix}-icons`, type: 1 });
  const made = [];
  try {
    // A group made over ServerQuery needs modify power 100; Server Admin has 75.
    await rig.sq.cmd("servergroupaddperm", {
      sgid,
      permsid: "i_group_needed_modify_power",
      permvalue: 75,
      permnegated: 0,
      permskip: 0,
    });
    await rig.sq.cmd("servergroupaddclient", { sgid, cldbid: bob.dbId });
    // Likewise the rig's channels (made over ServerQuery) for channel permissions.
    await rig.sq.cmd("channeladdperm", {
      cid: rig.channels.a,
      permsid: "i_channel_needed_permission_modify_power",
      permvalue: 75,
    });

    // A guest is not offered the manager (b_icon_manage).
    const guestMenu = await menuLabels(alice.page, alice.page.locator(".tree .server-row"));
    assert.ok(!guestMenu.includes("Icons…"), `guest menu: ${guestMenu.join(", ")}`);

    /* ---- upload ---- */
    await openManager(page);
    const input = page.getByTestId("icon-input");
    await input.setInputFiles({ name: "i.png", mimeType: "image/png", buffer: icon });
    await page.locator(`[data-icon-id="${iconId}"]`).waitFor({ state: "visible", timeout: 15_000 });
    made.push(`icon_${iconId}`);
    assert.ok((await iconFiles(rig)).includes(`icon_${iconId}`), "named by its CRC-32");
    const before = new Set(await iconFiles(rig));
    await input.setInputFiles({ name: "big.png", mimeType: "image/png", buffer: big });
    const scaled = await until(async () => {
      const now = await iconFiles(rig);
      return now.find((n) => !before.has(n)) ?? null;
    }, "the big icon is uploaded (scaled)");
    made.push(scaled);
    const scaledId = scaled.slice("icon_".length);
    await page
      .locator(`[data-icon-id="${scaledId}"]`)
      .waitFor({ state: "visible", timeout: 5_000 });
    await until(
      () => loadedImg(page.getByTestId("icon-manager"), "img", new RegExp(`/icon/${iconId}$`)),
      "the manager shows the new icon",
    );
    await page.screenshot({ path: rig.artifact("m3-icon-manager.png") });
    await page.keyboard.press("Escape");

    /* ---- server group, from the server groups dialog ---- */
    await menu(page, clientRow(page, bob.nick), "Server groups…");
    await page.locator(`[data-sgid="${sgid}"] [data-testid=group-icon]`).click();
    await pick(page, iconId);
    const groupIcon = async () =>
      (await rig.serverQuery("servergrouplist")).find((g) => g.sgid === String(sgid))?.iconid;
    await until(async () => (await groupIcon()) >>> 0 === iconId, "the group has the icon");
    const badge = new RegExp(`/icon/${iconId}$`);
    await until(
      () => loadedImg(clientRow(bob.page, bob.nick), "img.grp-icon", badge),
      "the member sees the group badge",
    );

    /* ---- channel ---- */
    const chName = rig.channels.name("a");
    await menu(page, channelRow(page, chName), "Set icon…");
    await pick(page, iconId);
    await until(
      () => loadedImg(channelRow(bob.page, chName), "img.ch-icon", badge),
      "the other client sees the channel icon",
    );

    /* ---- client ---- */
    await menu(page, clientRow(page, bob.nick), "Set icon…");
    await pick(page, iconId);
    await until(
      () => loadedImg(clientRow(alice.page, bob.nick), "img.cl-icon", badge),
      "another client sees the client icon",
    );
    await bob.page.screenshot({ path: rig.artifact("m3-icons-tree.png") });

    /* ---- removal ---- */
    await menu(page, clientRow(page, bob.nick), "Set icon…");
    await pick(page, null);
    await until(
      async () => (await clientRow(alice.page, bob.nick).locator("img.cl-icon").count()) === 0,
      "the client icon goes",
    );
    await menu(page, channelRow(page, chName), "Set icon…");
    await pick(page, null);
    await until(
      async () => (await channelRow(bob.page, chName).locator("img.ch-icon").count()) === 0,
      "the channel icon goes",
    );
    await menu(page, clientRow(page, bob.nick), "Server groups…");
    await page.locator(`[data-sgid="${sgid}"] [data-testid=group-icon]`).click();
    await pick(page, null);
    await until(async () => Number((await groupIcon()) ?? 0) === 0, "the group icon goes");
    await until(
      async () =>
        (await clientRow(bob.page, bob.nick)
          .locator(`img.grp-icon[src$="/icon/${iconId}"]`)
          .count()) === 0,
      "the badge goes",
    );

    /* ---- delete the icon files ---- */
    await openManager(page);
    for (const name of made) {
      const id = name.slice("icon_".length);
      await page.locator(`[data-icon-id="${id}"] [data-testid=icon-delete]`).click();
      await confirm(page);
      await page.locator(`[data-icon-id="${id}"]`).waitFor({ state: "detached", timeout: 10_000 });
    }
    const left = await iconFiles(rig);
    assert.ok(!made.some((n) => left.includes(n)), `icons deleted: ${left.join(", ")}`);
    made.length = 0;
    await page.keyboard.press("Escape");
  } finally {
    await rig.sq.cmd("servergroupdel", { sgid, force: 1 }).catch(() => undefined);
    await rig.sq
      .cmd("channeldelperm", { cid: rig.channels.a, permsid: "i_icon_id" })
      .catch(() => undefined);
    await rig.sq
      .cmd("clientdelperm", { cldbid: bob.dbId, permsid: "i_icon_id" })
      .catch(() => undefined);
    for (const name of made) {
      await rig.sq
        .cmd("ftdeletefile", { cid: 0, cpw: "", name: `/${name}` })
        .catch(() => undefined);
    }
  }
}

export default async function m3AvatarIcons(rig) {
  const admin = await rig.connect("iconadmin", { admin: true });
  const alice = await rig.connect("avatar");
  const bob = await rig.connect("watcher");
  await rig.waitForClientInTree(bob.page, alice.nick);
  await rig.waitForClientInTree(alice.page, bob.nick);
  await rig.waitForClientInTree(admin.page, bob.nick);

  await avatar(rig, alice, bob);
  rig.log("avatar ok");
  await icons(rig, admin, bob, alice);
  rig.log("icons ok");
}
