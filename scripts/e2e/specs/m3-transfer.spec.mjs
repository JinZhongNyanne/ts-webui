/**
 * M3 transfer core: uploads and downloads through the hub's streaming routes,
 * driven through the page's transfers store (stores/transfers.ts); the file
 * browser UI comes later. A Server Admin uploads into a channel with a
 * password, another client lists and downloads it and gets the same bytes;
 * more downloads than the hub gives one session at once, together with an
 * upload, all go through (the ones with no slot wait and ask again);
 * a wrong password and a missing upload permission are refused with a
 * readable reason; a cancelled upload leaves nothing on the server.
 *
 * Page functions cannot close over the spec's scope, so each one looks the
 * store up itself (`transfers()` below is repeated inside them for that).
 */
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { until } from "../lib/rig.mjs";

export const title = "m3 transfer: upload, list, download, refusals, cancel";

const sha = (buf) => createHash("sha256").update(buf).digest("hex");

/** Uploads bytes (base64) as `name` into the channel root and waits for the outcome. */
function upload(page, arg) {
  return page.evaluate(async (a) => {
    const transfers = () =>
      document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("transfers");
    const store = transfers();
    const bytes = Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
    const id = store.uploadFile(a.cid, "/", new File([bytes], a.name), { cpw: a.cpw });
    const done = await store.waitFor(id);
    return { state: done.state, error: done.error ?? null, loaded: done.loaded };
  }, arg);
}

/** Starts a download and waits for its transfer to settle (not for the browser's download). */
function download(page, arg) {
  return page.evaluate(async (a) => {
    const transfers = () =>
      document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("transfers");
    const store = transfers();
    const done = await store.waitFor(store.downloadFile(a.cid, a.path, a.cpw));
    return { state: done.state, error: done.error ?? null, size: done.size };
  }, arg);
}

function list(page, arg) {
  return page.evaluate(async (a) => {
    const transfers = () =>
      document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("transfers");
    try {
      return { entries: await transfers().listFiles(a.cid, "/", a.cpw) };
    } catch (err) {
      return { error: err.message };
    }
  }, arg);
}

/**
 * Starts `count` downloads of the same file and an upload at the same time —
 * more transfers than a session's slots — and waits for every one of them.
 * The downloads are fetched into the page (the same tickets and streams a
 * saved download uses, minus the browser's own download manager, which
 * refuses to save several files nobody clicked for).
 */
function downloadsAndUpload(page, arg) {
  return page.evaluate(async (a) => {
    const transfers = () =>
      document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("transfers");
    const store = transfers();
    const hex = (buf) =>
      [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
    const fetches = Array.from({ length: a.count }, async () => {
      try {
        const blob = await store.fetchFile(a.cid, a.path, { cpw: a.cpw, maxBytes: a.maxBytes });
        return {
          state: "done",
          sha: hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())),
        };
      } catch (err) {
        return { state: "failed", error: String(err && err.message) };
      }
    });
    const bytes = new Uint8Array(a.uploadSize);
    crypto.getRandomValues(bytes.subarray(0, 65536));
    const upload = store
      .waitFor(store.uploadFile(a.cid, "/", new File([bytes], a.name), { cpw: a.cpw }))
      .then((t) => ({ state: t.state, error: t.error ?? null }));
    return Promise.all([...fetches, upload]);
  }, arg);
}

/** Starts an 80 MB upload, cancels it once bytes are moving, and reports how it ended. */
function uploadAndCancel(page, arg) {
  return page.evaluate(async (a) => {
    const transfers = () =>
      document.querySelector("#app").__vue_app__.config.globalProperties.$pinia._s.get("transfers");
    const store = transfers();
    // Made here: sending 80 MB through evaluate would take longer than the upload.
    // getRandomValues fills at most 64 KB per call.
    const chunk = new Uint8Array(1024 * 1024);
    for (let o = 0; o < chunk.length; o += 65536) {
      crypto.getRandomValues(chunk.subarray(o, o + 65536));
    }
    const parts = Array.from({ length: 80 }, () => chunk);
    const id = store.uploadFile(a.cid, "/", new File(parts, a.name), { cpw: a.cpw });
    const t0 = Date.now();
    while (Date.now() - t0 < 10_000) {
      const item = store.items.find((t) => t.id === id);
      if (item.state === "running" && item.loaded > 0) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    store.cancel(id);
    const done = await store.waitFor(id);
    return { state: done.state, loaded: done.loaded, size: done.size };
  }, arg);
}

export default async function m3Transfer(rig) {
  const password = `pw ${rig.runId}`;
  const [{ cid: rawCid }] = await rig.sq.cmd("channelcreate", {
    channel_name: `${rig.prefix}-files`,
    cpid: rig.channels.root,
    channel_password: password,
    channel_flag_semi_permanent: 1,
  });
  const cid = String(rawCid);
  try {
    const admin = await rig.connect("ftadmin", { admin: true });
    const user = await rig.connect("ftuser");
    await rig.waitForClientInTree(user.page, admin.nick);

    /* ---- upload by the admin, list and download by the other client ---- */
    const bytes = randomBytes(3 * 1024 * 1024 + 17);
    const name = `报告 ${rig.runId}.bin`;
    const up = await upload(admin.page, {
      cid,
      name,
      base64: bytes.toString("base64"),
      cpw: password,
    });
    assert.deepEqual(up, { state: "done", error: null, loaded: bytes.length }, "admin upload");

    const listed = await list(user.page, { cid, cpw: password });
    const entry = listed.entries?.find((e) => e.name === name);
    assert.ok(entry, `the other client lists the file: ${JSON.stringify(listed)}`);
    assert.equal(entry.size, bytes.length);
    assert.equal(entry.isDir, false);

    const [dl, result] = await Promise.all([
      user.page.waitForEvent("download", { timeout: 30_000 }),
      download(user.page, { cid, path: `/${name}`, cpw: password }),
    ]);
    assert.equal(result.state, "done", `download transfer: ${JSON.stringify(result)}`);
    assert.equal(dl.suggestedFilename(), name);
    const saved = await readFile(await dl.path());
    assert.equal(saved.length, bytes.length, "downloaded size");
    assert.equal(sha(saved), sha(bytes), "downloaded bytes are identical");

    /* ---- more at once than the hub's slots: all of them still go through ---- */
    const parallelName = `parallel ${rig.runId}.bin`;
    const outcomes = await downloadsAndUpload(admin.page, {
      cid,
      path: `/${name}`,
      cpw: password,
      count: 4,
      maxBytes: 16 * 1024 * 1024,
      uploadSize: 2 * 1024 * 1024,
      name: parallelName,
    });
    assert.ok(
      outcomes.every((o) => o.state === "done"),
      `four downloads and an upload all finish: ${JSON.stringify(outcomes)}`,
    );
    for (const done of outcomes.slice(0, 4)) {
      assert.equal(done.sha, sha(bytes), "every parallel download has the right bytes");
    }
    const withParallel = await list(user.page, { cid, cpw: password });
    assert.ok(
      withParallel.entries?.some((e) => e.name === parallelName),
      "the upload alongside the downloads is on the server",
    );
    await rig.sq
      .cmd("ftdeletefile", { cid, cpw: password, name: `/${parallelName}` })
      .catch(() => undefined);

    /* ---- refusals, with the reason in words ---- */
    const wrongList = await list(user.page, { cid, cpw: "nope" });
    assert.equal(wrongList.error, "Wrong channel password");
    const wrongDl = await download(user.page, { cid, path: `/${name}`, cpw: "nope" });
    assert.deepEqual(wrongDl, { state: "failed", error: "Wrong channel password", size: 0 });

    const denied = await upload(user.page, {
      cid,
      name: "guest.txt",
      base64: Buffer.from("guest").toString("base64"),
      cpw: password,
    });
    assert.equal(denied.state, "failed");
    assert.match(denied.error, /i_ft_needed_file_upload_power/, "names the missing permission");

    /* ---- cancel mid-upload: nothing is left behind ---- */
    const cancelled = await uploadAndCancel(admin.page, { cid, cpw: password, name: "cancel.bin" });
    assert.equal(cancelled.state, "cancelled", JSON.stringify(cancelled));
    assert.ok(cancelled.loaded < cancelled.size, "cancelled before the end");
    await until(async () => {
      const after = await list(admin.page, { cid, cpw: password });
      return after.entries && !after.entries.some((e) => e.name === "cancel.bin");
    }, "the cancelled upload leaves no file");
  } finally {
    await rig.sq.cmd("channeldelete", { cid, force: 1 }).catch(() => undefined);
  }
}
