/**
 * M3 chat files: a Server Admin attaches a file in channel chat (📎 button),
 * it is uploaded into the channel's `/files` folder (pictures go to `/imgs`;
 * see chat/files/folders.ts) and a `[URL=ts3file://…]` message goes out;
 * the other client sees a file card (not a link) and downloads the
 * same bytes. The same name again gets " (2)". A pasted screenshot gets a
 * generated name and shows itself as a sticker with nobody clicking anything
 * (through the hub, as a blob: URL), while a picture over the sticker limit
 * keeps its Preview button. Turning "show small images automatically" off
 * brings the plain card back, and turning it on loads the picture after all.
 * A shown picture has no buttons: its menu (right button) downloads it. A raw
 * ts3file link typed the way the TS3 client writes it renders as a card too
 * and downloads. A guest without upload permission gets the server's reason
 * next to the composer, and nothing is sent.
 *
 * Every file the spec uploads is deleted at the end (the channel tree goes
 * with the rig's cleanup too).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { crc32 } from "node:zlib";
import { until } from "../lib/rig.mjs";

export const title =
  "m3 chat files: attach, card, download, stickers + setting, image menu, native link, refusal";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** A 64×64 red PNG: big enough on screen to read as a sticker. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAeUlEQVR4nO3PQQkAMAzAwAqrfxUTMxF7HINABFzm7H7dcEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFDWhBA1rQgBY0oAUNaEEDWtCAFjSgBQ1oQQNa0IAWNKAFj108cEE8uoIF1wAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The same PNG padded with a `tEXt` chunk until it is over the sticker limit
 * (AUTO_PREVIEW_MAX_BYTES, 256 KB). Browsers ignore the chunk, so it still
 * decodes to the same 64×64 picture — it is only too big to load by itself.
 */
function paddedPng(padBytes) {
  const data = Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.alloc(padBytes, 0x41)]);
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "latin1");
  data.copy(chunk, 8);
  const crc = crc32(Buffer.concat([Buffer.from("tEXt", "latin1"), data])) >>> 0;
  chunk.writeUInt32BE(crc, 8 + data.length);
  // Everything but the trailing IEND, then the padding, then IEND.
  return Buffer.concat([PNG.subarray(0, -12), chunk, PNG.subarray(-12)]);
}

const BIG_PNG = paddedPng(300 * 1024);

/** The card of the picture pasted as `image_<stamp>.png`, in `panel`. */
const pastedCardOf = (panel, page) =>
  panel
    .locator(".bb-file")
    .filter({ has: page.locator(".bb-file-name", { hasText: /^image_\d{8}-\d{6}\.png$/ }) })
    .first();

/** Flips "show small images automatically" in the chat settings pane. */
async function setAutoImages(page, on) {
  await page.getByTestId("status-settings").click();
  const panel = page.locator(".dialog-panel");
  await panel.waitFor();
  await panel.getByTestId("settings-tab-chat").click();
  const box = panel.getByTestId("chat-auto-images");
  await box.waitFor({ state: "visible" });
  if (on) await box.check();
  else await box.uncheck();
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "detached" });
}

/** The card for file `name` in `panel`. */
const cardOf = (panel, page, name) =>
  panel
    .locator(".bb-file")
    .filter({ has: page.locator(".bb-file-name", { hasText: name }) })
    .first();

/** Clicks a card's download button and returns the downloaded bytes and name. */
async function downloadFromCard(page, card) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    card.locator('[data-ft-act="download"]').click(),
  ]);
  return { name: dl.suggestedFilename(), bytes: await readFile(await dl.path()) };
}

/** Pastes files into the composer input, as a screenshot paste would. */
function pasteFile(panel, file) {
  return panel.locator(".composer input").evaluate((input, f) => {
    const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], f.name, { type: f.type }));
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  }, file);
}

export default async function m3ChatFiles(rig) {
  const cid = rig.channels.a;
  const channel = rig.channels.name("a");
  const created = new Set();
  try {
    const alice = await rig.connect("cfalice", { admin: true });
    const bob = await rig.connect("cfbob");
    await rig.waitForClientInTree(alice.page, bob.nick);

    /* ---- attach with the 📎 button: card on the other side, identical bytes ---- */
    const bytes = randomBytes(256 * 1024 + 7);
    const name = `报告 [${rig.runId}] & more.bin`;
    const alicePanel = await rig.openChat(alice.page, channel);
    await alicePanel.locator(".composer .attach").waitFor({ state: "visible" });
    await alicePanel.locator("input.picker").setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: bytes,
    });
    created.add(`/files/${name}`);

    const bobPanel = await rig.openChat(bob.page, channel);
    const card = cardOf(bobPanel, bob.page, name);
    await card.waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await card.locator(".bb-file-size").textContent(), "256 KB");
    assert.equal(await bobPanel.locator(`a[href^="ts3file"]`).count(), 0, "never an href");
    // The composer's progress row is gone once the message is out.
    await until(
      async () => (await alicePanel.locator('[data-testid="chat-upload"]').count()) === 0,
      "the upload row leaves alice's composer",
    );

    // Chat sorts what it uploads: pictures into /imgs, everything else into /files.
    const files = await rig.sq.cmd("ftgetfilelist", { cid, cpw: "", path: "/files" });
    assert.ok(
      files.some((f) => f.name === name && Number(f.size) === bytes.length),
      "the file is in the channel's /files folder",
    );
    const root = await rig.sq.cmd("ftgetfilelist", { cid, cpw: "", path: "/" });
    assert.equal(
      root.filter((f) => f.name === name).length,
      0,
      "and not loose in the channel's root",
    );

    const got = await downloadFromCard(bob.page, card);
    assert.equal(got.name, name);
    assert.equal(sha(got.bytes), sha(bytes), "bob downloads identical bytes");

    /* ---- the same name again does not overwrite: " (2)" ---- */
    await alicePanel.locator("input.picker").setInputFiles({
      name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from("second"),
    });
    const second = name.replace(/\.bin$/, " (2).bin");
    created.add(`/files/${second}`);
    await cardOf(bobPanel, bob.page, second).waitFor({ state: "visible", timeout: 30_000 });

    /* ---- paste a screenshot: a small picture becomes a sticker by itself ---- */
    await pasteFile(alicePanel, {
      name: "image.png",
      type: "image/png",
      base64: PNG.toString("base64"),
    });
    const imageCard = pastedCardOf(bobPanel, bob.page);
    await imageCard.waitFor({ timeout: 30_000 });
    const imageName = (await imageCard.locator(".bb-file-name").textContent()).trim();
    created.add(`/imgs/${imageName}`);
    assert.ok(
      (await rig.sq.cmd("ftgetfilelist", { cid, cpw: "", path: "/imgs" })).some(
        (f) => f.name === imageName,
      ),
      "the pasted picture went to /imgs, not to /files",
    );

    // Nobody clicked anything: the card loaded its own picture and became it.
    const img = imageCard.locator("img.bb-sticker-img");
    await img.waitFor({ state: "visible", timeout: 30_000 });
    const shown = await img.evaluate((el) => ({
      src: el.src,
      w: el.naturalWidth,
      title: el.title,
      alt: el.alt,
    }));
    assert.match(shown.src, /^blob:/, "the sticker is a blob: URL from the hub's download");
    assert.equal(shown.w, 64, "the image decoded");
    assert.equal(shown.title, imageName, "the file name is still there, on hover");
    assert.equal(shown.alt, imageName);
    assert.ok(
      await imageCard.evaluate((el) => el.classList.contains("sticker")),
      "the card is just the picture now",
    );
    // The chrome is gone with it: no name, no size, no download button.
    for (const part of [".bb-file-name", ".bb-file-size", '[data-ft-act="download"]']) {
      assert.equal(
        await imageCard.locator(part).first().isVisible(),
        false,
        `${part} is not shown next to a picture`,
      );
    }

    // The sender sees their own picture too, from the bytes they just sent.
    await pastedCardOf(alicePanel, alice.page)
      .locator("img.bb-sticker-img")
      .waitFor({ state: "visible", timeout: 30_000 });

    /* ---- the picture's menu: right button, Download, same bytes ---- */
    const [menuDownload] = await Promise.all([
      bob.page.waitForEvent("download", { timeout: 30_000 }),
      (async () => {
        await img.click({ button: "right" });
        const menu = bob.page.getByTestId("file.download");
        await menu.waitFor({ state: "visible", timeout: 10_000 });
        // "Open in a new tab" is there too, the blob: URL being this page's own.
        assert.ok(await bob.page.getByTestId("file.openTab").isVisible());
        await menu.click();
      })(),
    ]);
    assert.equal(menuDownload.suggestedFilename(), imageName);
    assert.equal(
      sha(await readFile(await menuDownload.path())),
      sha(PNG),
      "the menu downloads the picture's own bytes",
    );

    /* ---- a picture over the limit keeps its button ---- */
    const bigName = `big [${rig.runId}].png`;
    await alicePanel.locator("input.picker").setInputFiles({
      name: bigName,
      mimeType: "image/png",
      buffer: BIG_PNG,
    });
    created.add(`/${bigName}`);
    const bigCard = cardOf(bobPanel, bob.page, bigName);
    await bigCard.waitFor({ timeout: 30_000 });
    // Give the loader every chance to do the wrong thing before ruling it out.
    await bob.page.waitForTimeout(3_000);
    assert.equal(await bigCard.locator("img").count(), 0, "a big picture does not load itself");
    await bigCard.locator('[data-ft-act="preview"]').click();
    const bigImg = bigCard.locator("img.bb-sticker-img");
    await bigImg.waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await bigImg.evaluate((el) => el.naturalWidth), 64, "it previews after the click");

    /* ---- with the setting off nothing loads itself; back on, it does ---- */
    await setAutoImages(bob.page, false);
    const offName = `off [${rig.runId}].png`;
    await alicePanel.locator("input.picker").setInputFiles({
      name: offName,
      mimeType: "image/png",
      buffer: PNG,
    });
    created.add(`/${offName}`);
    const offCard = cardOf(bobPanel, bob.page, offName);
    await offCard.waitFor({ timeout: 30_000 });
    await bob.page.waitForTimeout(3_000);
    assert.equal(await offCard.locator("img").count(), 0, "the setting held the picture back");
    assert.ok(
      await offCard.locator('[data-ft-act="preview"]').isVisible(),
      "it is a plain card with its Preview button",
    );
    // The same card, once the setting allows it: proof only the setting said no.
    await setAutoImages(bob.page, true);
    await offCard.locator("img.bb-sticker-img").waitFor({ state: "visible", timeout: 30_000 });

    /* ---- a raw link typed the way the TS3 client writes it ---- */
    const native =
      `[URL=ts3file://localhost?port=9987&channel=${cid}&path=%2Ffiles` +
      `&filename=${encodeURIComponent(name)}&isDir=0&size=${bytes.length}&fileDateTime=1]` +
      `${rig.runId}-native[/URL]`;
    await rig.sendChannelMessage(bob, native, channel);
    const nativeLine = await rig.waitForChatMessage(alice, name, channel, bob.nick);
    const nativeCard = nativeLine.locator(".bb-file").first();
    const nativeText = await nativeLine.locator(".text").textContent();
    assert.ok(!nativeText.includes("native"), "the card shows the file's name, not the label");
    const again = await downloadFromCard(alice.page, nativeCard);
    assert.equal(sha(again.bytes), sha(bytes), "the native link downloads the same file");

    /* ---- a guest without upload permission: the reason, and nothing sent ---- */
    const before = await bobPanel.locator(".bb-file").count();
    await bobPanel.locator("input.picker").setInputFiles({
      name: "guest.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("guest"),
    });
    const failed = bobPanel.locator('[data-testid="chat-upload"].failed');
    await failed.waitFor({ state: "visible", timeout: 15_000 });
    assert.match(await failed.textContent(), /i_ft_needed_file_upload_power/);
    assert.equal(await bobPanel.locator(".bb-file").count(), before, "nothing was sent");
    await failed.locator("button").click();
    await failed.waitFor({ state: "detached" });
  } finally {
    for (const path of created) {
      await rig.sq.cmd("ftdeletefile", { cid, cpw: "", name: path }).catch(() => undefined);
    }
    // The folders are this spec's own doing; the channel goes with the rig.
    for (const dir of ["/imgs", "/files"]) {
      await rig.sq.cmd("ftdeletefile", { cid, cpw: "", name: dir }).catch(() => undefined);
    }
  }
}
