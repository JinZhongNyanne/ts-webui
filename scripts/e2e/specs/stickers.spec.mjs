/**
 * Stickers: pictures kept on the hub and dropped into chat.
 *
 * Alice puts one in a pack of the shared set; Bob sees it without reloading
 * and sends it into the channel chat, where Alice gets it as a file card and
 * the picture itself lands in the channel's `/imgs` folder. Sending the same
 * sticker again in that channel uploads nothing: the file is already there,
 * under a name made from the picture's hash. A personal sticker stays with
 * its owner, deleting a shared one takes it from everyone, and a file that is
 * not a picture never leaves the page.
 *
 * The chat folders are checked here too, since stickers share them: a picture
 * sent with 📎 goes to `/imgs`, anything else to `/files`, and the receiver
 * downloads it from there.
 *
 * Everything this spec puts in the channel is deleted at the end; the channel
 * tree itself goes with the rig's cleanup.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { until } from "../lib/rig.mjs";

export const title = "stickers: shared and personal, packs, sending once per channel";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** A 2×2 red PNG, and a 2×2 blue one, so the two are told apart by their hash. */
const RED = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64",
);
const BLUE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAAD0eNT6AAAAEklEQVR4nGNkYPjPgAUwYRMcsgIAULwBAT5SMxAAAAAASUVORK5CYII=",
  "base64",
);

/** What the hub names the channel file for a picture: the first 12 hash characters. */
const fileNameOf = (buf) => `sticker_${sha(buf).slice(0, 12)}.png`;

/**
 * The picker is teleported to the page body (it has to escape the dock window
 * that clips the chat panel), so it is looked up on the page rather than inside
 * the panel — one chat panel per page here, so the page-wide handle is exact.
 */
async function openPicker(panel) {
  await panel.locator("[data-testid=sticker-button]").click();
  const picker = panel.page().locator("[data-testid=sticker-picker]");
  await picker.waitFor({ state: "visible", timeout: 10_000 });
  return picker;
}

/** The picker covers the chat log, so it is closed before reading the messages. */
async function closePicker(picker) {
  await picker.locator("[data-testid=sticker-close]").click();
  await picker.waitFor({ state: "detached", timeout: 10_000 });
}

/** The names of the stickers shown in the picker's groups (not the recent row). */
const stickerNames = (picker) =>
  picker.locator("[data-testid=sticker] img").evaluateAll((els) => els.map((e) => e.alt));

/** Text content, not innerText: the headings are upper-cased by CSS. */
const packTitles = async (picker) =>
  (await picker.locator("[data-testid=sticker-pack-title]").allTextContents()).map((s) => s.trim());

/** The card for file `name` in `panel`. */
const cardOf = (panel, page, name) =>
  panel
    .locator(".bb-file")
    .filter({ has: page.locator(".bb-file-name", { hasText: name }) })
    .first();

/**
 * A sticker in the chat log is shown as the picture itself, without the
 * card's name or buttons, so downloading it goes through its menu (the right
 * button on a desktop, a held finger on a phone).
 */
async function downloadFromCard(page, card) {
  // A picture small enough to show itself becomes the picture alone — no
  // name, no buttons — so it is downloaded from its menu, as a user does;
  // anything else (a text file here) still has its Download button.
  const picture = card.locator("img.bb-sticker-img");
  const shown = await picture
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    (async () => {
      if (!shown) {
        await card.locator('[data-ft-act="download"]').click();
        return;
      }
      await picture.click({ button: "right" });
      await page.getByTestId("file.download").click();
    })(),
  ]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

/** The entries of one of the channel's folders; an empty or missing folder is []. */
async function listDir(rig, cid, path) {
  try {
    return await rig.sq.cmd("ftgetfilelist", { cid, cpw: "", path });
  } catch {
    return [];
  }
}

export default async function stickers(rig) {
  const cid = rig.channels.a;
  const channel = rig.channels.name("a");
  const packName = `pack ${rig.runId}`;
  const created = new Set();
  const sticker = fileNameOf(RED);

  try {
    // Both need upload and folder-create rights, which Server Admin has.
    const alice = await rig.connect("stalice", { admin: true });
    const bob = await rig.connect("stbob", { admin: true });
    await rig.waitForClientInTree(alice.page, bob.nick);

    const alicePanel = await rig.openChat(alice.page, channel);
    const bobPanel = await rig.openChat(bob.page, channel);

    /* ---- alice makes a pack and puts a sticker in it ---- */
    const aPicker = await openPicker(alicePanel);
    await aPicker.locator("[data-testid=sticker-manage]").click();
    await aPicker.locator("[data-testid=sticker-pack-name]").fill(packName);
    await aPicker.locator("[data-testid=sticker-pack-add]").click();
    await until(async () => (await packTitles(aPicker)).includes(packName), "the pack appears");

    await aPicker.locator("[data-testid=sticker-upload-name]").fill("red square");
    await aPicker.locator("[data-testid=sticker-upload-pack]").selectOption({ label: packName });
    await aPicker.locator("[data-testid=sticker-upload-file]").setInputFiles({
      name: "red.png",
      mimeType: "image/png",
      buffer: RED,
    });
    await until(
      async () => (await stickerNames(aPicker)).includes("red square"),
      "alice sees her sticker",
    );

    /* ---- a file that is not a picture never leaves the page ---- */
    await aPicker.locator("[data-testid=sticker-upload-file]").setInputFiles({
      name: "fake.png",
      mimeType: "image/png",
      buffer: Buffer.from("<html>not a picture</html>"),
    });
    await aPicker.locator("[data-testid=sticker-upload-error]").waitFor({ timeout: 10_000 });
    assert.equal(
      (await stickerNames(aPicker)).filter((n) => n === "fake").length,
      0,
      "nothing was added for the refused file",
    );
    await closePicker(aPicker);

    /* ---- bob sees it without reloading, in the same pack ---- */
    const bPicker = await openPicker(bobPanel);
    await until(
      async () => (await stickerNames(bPicker)).includes("red square"),
      "bob sees alice's sticker pushed to him",
    );
    assert.ok((await packTitles(bPicker)).includes(packName), "bob sees the pack too");

    /* ---- bob sends it: the picture lands in /imgs, alice gets the card ---- */
    await bPicker
      .locator("[data-testid=sticker]")
      .filter({ has: bob.page.locator(`img[alt="red square"]`) })
      .first()
      .click();
    created.add(`/imgs/${sticker}`);

    const card = cardOf(alicePanel, alice.page, sticker);
    await card.waitFor({ state: "visible", timeout: 30_000 });
    // The picker closes itself once the sticker is on its way.
    await bPicker.waitFor({ state: "detached", timeout: 10_000 });

    const imgs = await listDir(rig, cid, "/imgs");
    const sent = imgs.filter((f) => f.name === sticker);
    assert.equal(sent.length, 1, "the picture is in /imgs, once");
    assert.equal(Number(sent[0].size), RED.length, "and it is the picture alice uploaded");

    const got = await downloadFromCard(alice.page, card);
    assert.equal(sha(got.bytes), sha(RED), "alice downloads the picture bob sent");

    /* ---- sending it again does not upload it again ---- */
    const bAgain = await openPicker(bobPanel);
    await bAgain
      .locator("[data-testid=sticker]")
      .filter({ has: bob.page.locator(`img[alt="red square"]`) })
      .first()
      .click();
    await until(
      async () => (await alicePanel.locator(".bb-file").count()) >= 2,
      "alice gets the sticker a second time",
    );
    const after = await listDir(rig, cid, "/imgs");
    assert.equal(
      after.filter((f) => f.name === sticker).length,
      1,
      "the second send reused the file instead of uploading another",
    );
    assert.equal(after.length, imgs.length, "and added nothing else to /imgs");

    /* ---- a personal sticker is its owner's alone ---- */
    const aPersonal = await openPicker(alicePanel);
    await aPersonal.locator("[data-testid=sticker-scope-personal]").click();
    await aPersonal.locator("[data-testid=sticker-manage]").click();
    await aPersonal.locator("[data-testid=sticker-upload-name]").fill("just mine");
    await aPersonal.locator("[data-testid=sticker-upload-file]").setInputFiles({
      name: "blue.png",
      mimeType: "image/png",
      buffer: BLUE,
    });
    await until(
      async () => (await stickerNames(aPersonal)).includes("just mine"),
      "alice sees her personal sticker",
    );

    const bPersonal = await openPicker(bobPanel);
    await bPersonal.locator("[data-testid=sticker-scope-personal]").click();
    await bob.page.waitForTimeout(1_000); // a push would have arrived by now
    assert.deepEqual(
      await stickerNames(bPersonal),
      [],
      "bob's personal stickers are his own, and he has none",
    );
    await bPersonal.locator("[data-testid=sticker-scope-shared]").click();
    assert.ok(
      (await stickerNames(bPersonal)).includes("red square"),
      "the shared set is still there for bob",
    );

    /* ---- deleting a shared sticker takes it from everyone ---- */
    await aPersonal.locator("[data-testid=sticker-scope-shared]").click();
    await aPersonal
      .locator("[data-testid=sticker]")
      .filter({ has: alice.page.locator(`img[alt="red square"]`) })
      .first()
      .click();
    await aPersonal.locator("[data-testid=sticker-delete]").click();
    await alice.page.locator("[role=dialog][aria-modal=true] button.danger").click();
    await until(
      async () => !(await stickerNames(aPersonal)).includes("red square"),
      "alice's shared set loses it",
    );
    await until(
      async () => !(await stickerNames(bPersonal)).includes("red square"),
      "and so does bob's, without a reload",
    );
    await closePicker(aPersonal);
    await closePicker(bPersonal);

    /* ---- chat files are sorted into /imgs and /files ---- */
    const picture = `shot ${rig.runId}.png`;
    await alicePanel.locator("input.picker").setInputFiles({
      name: picture,
      mimeType: "image/png",
      buffer: BLUE,
    });
    created.add(`/imgs/${picture}`);
    await cardOf(bobPanel, bob.page, picture).waitFor({ state: "visible", timeout: 30_000 });

    const doc = `notes ${rig.runId}.txt`;
    await alicePanel.locator("input.picker").setInputFiles({
      name: doc,
      mimeType: "text/plain",
      buffer: Buffer.from("just some notes"),
    });
    created.add(`/files/${doc}`);
    const docCard = cardOf(bobPanel, bob.page, doc);
    await docCard.waitFor({ state: "visible", timeout: 30_000 });

    assert.ok(
      (await listDir(rig, cid, "/imgs")).some((f) => f.name === picture),
      "the picture went to /imgs",
    );
    assert.ok(
      (await listDir(rig, cid, "/files")).some((f) => f.name === doc),
      "the other file went to /files",
    );
    const root = await listDir(rig, cid, "/");
    assert.equal(
      root.filter((f) => f.name === picture || f.name === doc).length,
      0,
      "and neither was left in the channel's root",
    );
    assert.ok(
      root.some((f) => f.name === "imgs" && Number(f.type) === 0),
      "the file browser sees /imgs as an ordinary folder",
    );

    const gotDoc = await downloadFromCard(bob.page, docCard);
    assert.equal(gotDoc.name, doc);
    assert.equal(gotDoc.bytes.toString(), "just some notes", "bob downloads it from /files");
  } finally {
    for (const path of created) {
      await rig.sq.cmd("ftdeletefile", { cid, cpw: "", name: path }).catch(() => undefined);
    }
    // The folders are this spec's own; the channel goes with the rig's cleanup.
    for (const dir of ["/imgs", "/files"]) {
      await rig.sq.cmd("ftdeletefile", { cid, cpw: "", name: dir }).catch(() => undefined);
    }
  }
}
