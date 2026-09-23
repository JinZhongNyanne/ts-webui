/**
 * M3 file browser, through the "Files" window against the live server, in two
 * throwaway channels of its own (one with a password), deleted with their
 * files at the end. A Server Admin opens it from the channel menu, creates a
 * folder, drops two files onto the list, drops one again (replace, after a
 * confirm), renames one (a taken name is refused in the dialog: the server
 * would silently replace that file). A guest opens the window from the window
 * bar, browses there and downloads the renamed file (identical bytes); its
 * "New folder" and upload are refused with the missing permission named.
 * The admin deletes two files at once, after a confirm. The guest is asked
 * for the password channel's password (a wrong one is said to be wrong) and
 * not again. On a phone the window is a sheet that does not scroll sideways.
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { until } from "../lib/rig.mjs";

export const title = "m3 file browser: folders, drop upload, rename, download, delete, password";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const esc = (s) => s.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&");

const channelRow = (page, name) =>
  page.locator(".tree .channel").filter({
    has: page.locator(".channel-name", { hasText: new RegExp(`^${esc(name)}$`) }),
  });

const browser = (page) => page.getByTestId("file-browser").first();
const row = (page, name) => browser(page).locator(`[data-testid=fb-row][data-name="${name}"]`);

/** Names listed in the window, in table order. */
const rowNames = (page) =>
  browser(page)
    .locator("[data-testid=fb-row]")
    .evaluateAll((rows) => rows.map((r) => r.dataset.name));

/** What the server has in `path` of channel `cid`, via ServerQuery (names; "d:" for folders). */
async function serverList(rig, cid, path = "/", cpw = "") {
  try {
    const rows = await rig.sq.cmd("ftgetfilelist", { cid, cpw, path });
    return rows.map((r) => `${String(r.type) === "0" ? "d:" : ""}${r.name}`).sort();
  } catch (err) {
    if (err.id === "1281" || err.id === 1281) return [];
    throw err;
  }
}

/** Drops `files` ({name, bytes}) onto the list, as a drag from the desktop would. */
async function dropFiles(page, files) {
  const payload = files.map((f) => ({ name: f.name, base64: f.bytes.toString("base64") }));
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer();
    for (const f of list) {
      const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name));
    }
    return dt;
  }, payload);
  const zone = browser(page).getByTestId("fb-drop");
  await zone.dispatchEvent("dragover", { dataTransfer });
  await zone.dispatchEvent("drop", { dataTransfer });
}

/** Waits until every transfer in the page's queue has settled; returns their states. */
async function transfersSettled(page) {
  return until(async () => {
    const states = await browser(page)
      .locator("[data-testid=transfer-item]")
      .evaluateAll((items) => items.map((i) => i.dataset.state));
    return states.length && states.every((s) => !["queued", "running"].includes(s)) ? states : null;
  }, "the transfers finish");
}

async function nameDialog(page, value, submit) {
  const dialog = page
    .locator("[role=dialog][aria-modal=true]")
    .filter({ has: page.locator("input") })
    .last();
  await dialog.locator("input").fill(value);
  await dialog.locator("button.primary", { hasText: submit }).click();
  return dialog;
}

const confirmDialog = (page, title) =>
  page.locator("[role=dialog][aria-modal=true]", { hasText: title });

export default async function m3FileBrowser(rig) {
  const password = `pw ${rig.runId}`;
  const [{ cid: rawF }] = await rig.sq.cmd("channelcreate", {
    channel_name: `${rig.prefix}-files`,
    cpid: rig.channels.root,
    channel_flag_semi_permanent: 1,
  });
  const [{ cid: rawP }] = await rig.sq.cmd("channelcreate", {
    channel_name: `${rig.prefix}-locked`,
    cpid: rig.channels.root,
    channel_password: password,
    channel_flag_semi_permanent: 1,
  });
  const [cid, lockedCid] = [String(rawF), String(rawP)];
  try {
    const admin = await rig.connect("fbadmin", { admin: true });
    const guest = await rig.connect("fbguest");
    await rig.waitForClientInTree(guest.page, admin.nick);
    await adminWorks(rig, admin, cid);
    await guestBrowses(rig, guest, cid);
    await adminDeletes(rig, admin, cid);
    await passwordChannel(rig, guest, lockedCid);
    await phoneSheet(rig);
  } finally {
    for (const c of [cid, lockedCid]) {
      await rig.sq.cmd("channeldelete", { cid: c, force: 1 }).catch(() => undefined);
    }
  }
}

const A = { name: "a.txt", bytes: Buffer.from("first version of a\n") };
const A2 = { name: "a.txt", bytes: Buffer.from("second version of a, replaced\n") };
const B = { name: "b.bin", bytes: randomBytes(300 * 1024 + 5) };

async function adminWorks(rig, admin, cid) {
  const { page } = admin;
  /* ---- open from the channel menu, on that channel ---- */
  await channelRow(page, `${rig.prefix}-files`).first().click({ button: "right" });
  await page.locator(".cm-item .cm-label", { hasText: "Browse files…" }).first().click();
  await browser(page).getByTestId("fb-empty").waitFor({ timeout: 10_000 });
  assert.equal(await browser(page).getByTestId("fb-channel").inputValue(), cid);

  /* ---- new folder, then into it ---- */
  await browser(page).getByTestId("fb-new-folder").click();
  await nameDialog(page, "docs", "Create");
  await row(page, "docs").waitFor({ timeout: 10_000 });
  assert.deepEqual(await serverList(rig, cid), ["d:docs"], "the folder is on the server");
  await row(page, "docs").dblclick();
  await browser(page)
    .getByTestId("fb-breadcrumb")
    .locator(".current", { hasText: "docs" })
    .waitFor({ timeout: 5_000 });

  /* ---- two files dropped onto the list ---- */
  await dropFiles(page, [A, B]);
  assert.deepEqual(await transfersSettled(page), ["done", "done"], "both uploads finish");
  await until(async () => (await rowNames(page)).length === 2, "both files are listed");
  assert.deepEqual(await rowNames(page), ["a.txt", "b.bin"]);
  assert.deepEqual(await serverList(rig, cid, "/docs"), ["a.txt", "b.bin"]);

  /* ---- the same name again: asked first, then replaced ---- */
  await dropFiles(page, [A2]);
  const replace = confirmDialog(page, "Replace existing files?");
  await replace.locator(".message", { hasText: "a.txt" }).waitFor({ timeout: 5_000 });
  await replace.locator("button.danger", { hasText: "Replace" }).click();
  await until(
    async () => (await transfersSettled(page)).length === 3,
    "the replacing upload finishes",
  );
  const size = await until(async () => {
    const rows = await rig.sq.cmd("ftgetfilelist", { cid, cpw: "", path: "/docs" });
    const a = rows.find((r) => r.name === "a.txt");
    return Number(a?.size) === A2.bytes.length ? a.size : null;
  }, "the server has the new a.txt");
  assert.equal(Number(size), A2.bytes.length);

  /* ---- rename: a taken name is refused, a free one works ---- */
  await row(page, "b.bin").click();
  await browser(page).getByTestId("fb-rename").click();
  const dialog = await nameDialog(page, "a.txt", "Rename");
  await dialog
    .locator(".field", { hasText: "There is already a file or folder of that name here" })
    .waitFor({ timeout: 5_000 });
  await nameDialog(page, "c.bin", "Rename");
  await row(page, "c.bin").waitFor({ timeout: 10_000 });
  assert.deepEqual(
    await serverList(rig, cid, "/docs"),
    ["a.txt", "c.bin"],
    "renamed on the server",
  );
  await page.screenshot({ path: rig.artifact("m3-file-browser-desktop.png") });
}

async function guestBrowses(rig, guest, cid) {
  const { page } = guest;
  /* ---- the desktop icon, then the channel picker ---- */
  await rig.openFromDesktop(page, "files");
  await browser(page).getByTestId("fb-channel").selectOption(cid);
  await row(page, "docs").dblclick();
  await row(page, "c.bin").waitFor({ timeout: 10_000 });

  /* ---- download by double-click: the same bytes ---- */
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    row(page, "c.bin").dblclick(),
  ]);
  assert.equal(dl.suggestedFilename(), "c.bin");
  const saved = await readFile(await dl.path());
  assert.equal(sha(saved), sha(B.bytes), "the downloaded file is identical");

  /* ---- what a guest may not do: offered (power unknown), refused by name ---- */
  await browser(page).getByTestId("fb-new-folder").click();
  const dialog = await nameDialog(page, "guest", "Create");
  await dialog
    .locator(".field", { hasText: "i_ft_needed_directory_create_power" })
    .waitFor({ timeout: 10_000 });
  await dialog.locator("button", { hasText: "Cancel" }).click();

  await browser(page)
    .getByTestId("fb-file-input")
    .setInputFiles({ name: "guest.txt", mimeType: "text/plain", buffer: Buffer.from("guest") });
  const failed = browser(page).locator("[data-testid=transfer-item][data-state=failed]", {
    hasText: "guest.txt",
  });
  await failed.waitFor({ timeout: 15_000 });
  assert.match(await failed.innerText(), /i_ft_needed_file_upload_power/);
  assert.deepEqual(await serverList(rig, cid, "/docs"), ["a.txt", "c.bin"], "nothing new");
}

async function adminDeletes(rig, admin, cid) {
  const { page } = admin;
  await row(page, "a.txt").click();
  await row(page, "c.bin").click({ modifiers: ["Control"] });
  await browser(page).getByTestId("fb-delete").click();
  const confirm = confirmDialog(page, "Delete 2 items?");
  await confirm.locator(".message", { hasText: "a.txt, c.bin" }).waitFor({ timeout: 5_000 });
  await confirm.locator("button.danger", { hasText: "Delete" }).click();
  await browser(page).getByTestId("fb-empty").waitFor({ timeout: 10_000 });
  assert.deepEqual(await serverList(rig, cid, "/docs"), [], "both are gone from the server");
}

async function passwordChannel(rig, guest, lockedCid) {
  const { page } = guest;
  const form = browser(page).getByTestId("fb-password");
  await browser(page).getByTestId("fb-channel").selectOption(lockedCid);
  await form.waitFor({ timeout: 10_000 });
  await form.locator("input").fill("wrong");
  await form.locator("button[type=submit]").click();
  await form.locator(".hint.wrong", { hasText: "Wrong password" }).waitFor({ timeout: 10_000 });
  await form.locator("input").fill(`pw ${rig.runId}`);
  await form.locator("button[type=submit]").click();
  await browser(page).getByTestId("fb-empty").waitFor({ timeout: 10_000 });

  // Remembered for the session: away and back does not ask again.
  await browser(page).getByTestId("fb-channel").selectOption(rig.channels.a);
  await browser(page).getByTestId("fb-channel").selectOption(lockedCid);
  await browser(page).getByTestId("fb-empty").waitFor({ timeout: 10_000 });
  assert.equal(await form.count(), 0, "no second password prompt");
}

async function phoneSheet(rig) {
  const phone = await rig.connect("fbphone", { viewport: { width: 390, height: 844 } });
  const { page } = phone;
  await page.locator(".mshell .more").click();
  await page.getByTestId("mobile-open-files").click();
  await browser(page).getByTestId("fb-channel").waitFor({ timeout: 10_000 });
  const overflow = await page.evaluate(() => {
    const sheet = document.querySelector(".sheet");
    return sheet ? sheet.scrollWidth - sheet.clientWidth : -1;
  });
  assert.equal(overflow, 0, "the file sheet does not scroll sideways");
  await page.screenshot({ path: rig.artifact("m3-file-browser-phone.png") });
}
