/**
 * M2 channels, end to end against the live server: an admin creates a
 * subchannel with a password and a client limit (after the server refused a
 * taken name, shown under the field), a second client sees it appear and
 * joins it with that password, and so does a plain TeamSpeak client (which,
 * like the TS3 client, sends the password hashed); the
 * admin edits name, topic and description (with the BBCode preview); drags it
 * under another channel and back between rows (the other client's tree
 * follows, including the neighbours the server relinks silently), and the
 * same through the "Move channel…" dialog; deletes it with a client inside
 * (force, after a confirm that says so).
 */
import assert from "node:assert/strict";
import { Client, generateIdentity } from "@honeybbq/teamspeak-client";
import { until } from "../lib/rig.mjs";

export const title = "m2 channels: create, edit, drag-move, move dialog, delete";

const esc = (s) => s.replace(/[-.*+?^${}()|[\]\\]/g, "\\$&");

const channelRow = (page, name) =>
  page.locator(".tree .channel").filter({
    has: page.locator(".channel-name", { hasText: new RegExp(`^${esc(name)}$`) }),
  });

async function menu(page, row, label) {
  await row.first().click({ button: "right" });
  const item = page.locator(".cm-item .cm-label", { hasText: label }).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
}

const channelDialog = (page) =>
  page
    .locator("[role=dialog][aria-modal=true]")
    .filter({ has: page.getByTestId("channel-dialog") });

/** The server's view of a channel, by name. */
async function sqChannel(rig, name) {
  const list = await rig.sq.cmd("channellist", {}, ["topic", "flags", "limits"]);
  return list.find((c) => c.channel_name === name) ?? null;
}

/** Names of the channels directly under `parentName`, in the order `page` shows them. */
async function treeChildren(page, parentId) {
  return page.evaluate(async (pid) => {
    const { useTsStore } = await import("/src/stores/ts.ts");
    const { buildTree } = await import("/src/ts/tree.ts");
    const ts = useTsStore();
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.channel.id === pid) return n.children.map((c) => c.channel.name);
        const hit = walk(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return walk(buildTree(ts.channels.values(), [])) ?? [];
  }, parentId);
}

async function create(rig, admin, watcher) {
  const { page } = admin;
  const root = rig.channels.rootName;
  const rootRow = channelRow(page, root);
  await menu(page, rootRow, "Create subchannel…");
  const dialog = channelDialog(page);
  await dialog.waitFor({ timeout: 5_000 });

  // Nothing typed: caught before anything is sent.
  await dialog.locator("button[type=submit]").click();
  await dialog.locator(".note.error", { hasText: /name/i }).first().waitFor({ timeout: 3_000 });

  // A sibling's name: the server says no, under the name field.
  const name = dialog.locator("input[name=channel-name]");
  await name.fill(rig.channels.name("a"));
  await dialog.locator("button[type=submit]").click();
  await dialog
    .locator(".note.error", { hasText: "A channel with that name already exists" })
    .waitFor({ timeout: 10_000 });

  const newName = `${rig.prefix}-new`;
  await name.fill(newName);
  await dialog.locator("input[name=channel-has-password]").check();
  await dialog.locator("input[name=channel-password]").fill("pw-m2");
  await dialog.locator("[data-tab=limits]").click();
  await dialog.locator("input[name=channel-max][value=true]").check();
  await dialog.locator("input[name=channel-max-clients]").fill("3");
  await page.screenshot({ path: rig.artifact("m2-channel-limits.png") });
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });

  const ch = await until(() => sqChannel(rig, newName), "the server has the new channel");
  assert.equal(ch.pid, rig.channels.root, "created under the run's root");
  const [info] = await rig.sq.cmd("channelinfo", { cid: ch.cid });
  assert.equal(info.channel_flag_password, "1", "with a password");
  assert.equal(info.channel_password !== "", true);
  assert.equal(info.channel_maxclients, "3", "and a client limit");
  assert.equal(info.channel_flag_maxclients_unlimited, "0");
  await channelRow(watcher.page, newName).waitFor({ timeout: 10_000 });
  return { cid: ch.cid, name: newName, password: "pw-m2" };
}

/** The server's idea of which channel a client is in. */
async function sqChannelOf(rig, clid) {
  const [info] = await rig.sq.cmd("clientinfo", { clid });
  return info?.cid;
}

/**
 * The password set from the web works for joining: the watcher joins through
 * the tree's password prompt, then a plain TeamSpeak client connects with the
 * channel as its default (the library hashes the password, as the TS3 client
 * does). Created with the password in clear, the channel let neither in.
 */
async function joinWithPassword(rig, watcher, ch) {
  const { page } = watcher;
  await menu(page, channelRow(page, ch.name), "Join channel");
  const prompt = page.locator("[role=dialog][aria-modal=true]", { hasText: "Channel password" });
  await prompt.locator("input[type=password]").fill(ch.password);
  await prompt.locator("button.primary").click();
  await until(
    async () => (await sqChannelOf(rig, watcher.clid)) === ch.cid,
    "the watcher joined the password channel",
  );
  // Back out, so the rest of the spec starts where it did.
  await rig.sq.cmd("clientmove", { clid: watcher.clid, cid: rig.channels.b });

  const nick = `${rig.prefix}-native`;
  const quiet = () => undefined;
  const client = new Client(
    generateIdentity(8),
    `${rig.config.tsHost}:${rig.config.tsPort}`,
    nick,
    {
      logger: { debug: quiet, info: quiet, warn: quiet, error: quiet },
      defaultChannel: `/${ch.cid}`,
      defaultChannelPassword: ch.password,
    },
  );
  try {
    await client.connect();
    await client.waitConnected(AbortSignal.timeout(15_000));
    const rec = await until(
      async () => (await rig.sq.cmd("clientlist")).find((c) => c.client_nickname === nick),
      "the plain client is online",
    );
    rig.dbIds.add(rec.client_database_id);
    assert.equal(rec.cid, ch.cid, "the plain client landed in the password channel");
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}

async function edit(rig, admin, watcher, ch) {
  const { page } = admin;
  await menu(page, channelRow(page, ch.name), "Edit channel…");
  const dialog = channelDialog(page);
  await dialog.waitFor({ timeout: 5_000 });
  const renamed = `${rig.prefix}-renamed`;
  await dialog.locator("input[name=channel-name]").fill(renamed);
  await dialog.locator("input[name=channel-topic]").fill("m2 topic");
  await dialog.locator("[data-tab=description]").click();
  await dialog.locator("textarea[name=channel-description]").fill("hello [b]bold[/b]");
  await dialog
    .getByTestId("channel-description-preview")
    .locator("b", { hasText: "bold" })
    .waitFor({ timeout: 3_000 });
  await page.screenshot({ path: rig.artifact("m2-channel-description.png") });
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });

  await until(async () => {
    const [info] = await rig.sq.cmd("channelinfo", { cid: ch.cid });
    return (
      info.channel_name === renamed &&
      info.channel_topic === "m2 topic" &&
      info.channel_description === "hello [b]bold[/b]" &&
      info.channel_flag_password === "1"
    );
  }, "the server has the new name, topic and description, and still the password");
  const row = channelRow(watcher.page, renamed);
  await row.waitFor({ timeout: 10_000 });
  await until(
    async () => ((await row.getAttribute("title")) ?? "").includes("m2 topic"),
    "the watcher sees the topic",
  );
  // The watcher's info panel shows the new description.
  await row.click();
  await watcher.page.locator(".info .rich b", { hasText: "bold" }).waitFor({ timeout: 10_000 });
  ch.name = renamed;
}

/** Drags `from` onto `to` at a fraction of its height (0.5 = into it). */
async function drag(page, from, to, fraction) {
  const box = await to.first().boundingBox();
  await from.first().dragTo(to.first(), {
    targetPosition: { x: box.width / 2, y: Math.round(box.height * fraction) },
  });
}

async function move(rig, admin, watcher, ch) {
  const { page } = admin;
  const [a, b, root] = [rig.channels.a, rig.channels.b, rig.channels.root];
  const [aName, bName] = [rig.channels.name("a"), rig.channels.name("b")];

  // Into b.
  await drag(page, channelRow(page, ch.name), channelRow(page, bName), 0.5);
  await until(
    async () => (await sqChannel(rig, ch.name))?.pid === b,
    "the server moved it under b",
  );
  await until(
    async () => (await treeChildren(watcher.page, b)).includes(ch.name),
    "the watcher sees it under b",
  );

  // Back to the root, between a and b (the lower edge of a).
  await drag(page, channelRow(page, ch.name), channelRow(page, aName), 0.9);
  await until(async () => {
    const c = await sqChannel(rig, ch.name);
    return c?.pid === root && c.channel_order === a;
  }, "the server put it back after a");
  await until(
    async () =>
      JSON.stringify(await treeChildren(watcher.page, root)) ===
      JSON.stringify([aName, ch.name, bName]),
    "the watcher sees a, it, b",
  );

  // Same parent, to the top (the upper edge of a): a reorder, not a move.
  await drag(page, channelRow(page, ch.name), channelRow(page, aName), 0.1);
  await until(
    async () => (await sqChannel(rig, ch.name))?.channel_order === "0",
    "the server put it first",
  );
  await until(
    async () =>
      JSON.stringify(await treeChildren(watcher.page, root)) ===
      JSON.stringify([ch.name, aName, bName]),
    "the watcher sees it, a, b",
  );
  assert.deepEqual(
    await treeChildren(page, root),
    [ch.name, aName, bName],
    "the admin's own tree agrees",
  );
}

/** "Move channel…": the menu's way to do what dragging does (phones, keyboards). */
async function moveByDialog(rig, admin, ch) {
  const { page } = admin;
  const [a, b, root] = [rig.channels.a, rig.channels.b, rig.channels.root];
  const dialogFor = () =>
    page
      .locator("[role=dialog][aria-modal=true]")
      .filter({ has: page.getByTestId("move-channel-dialog") });

  // Under b, first (its only subchannel).
  await menu(page, channelRow(page, ch.name), "Move channel…");
  let dialog = dialogFor();
  const submit = dialog.locator("button[type=submit]");
  assert.ok(await submit.isDisabled(), "nothing to do until something is picked");
  await dialog.locator("select[name=parent]").selectOption(b);
  await page.screenshot({ path: rig.artifact("m2-move-channel-dialog.png") });
  await submit.click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(
    async () => (await sqChannel(rig, ch.name))?.pid === b,
    "the dialog moved it under b",
  );

  // Back under the root, right after a.
  await menu(page, channelRow(page, ch.name), "Move channel…");
  dialog = dialogFor();
  await dialog.locator("select[name=parent]").selectOption(root);
  await dialog.locator("select[name=order]").selectOption(a);
  await dialog.locator("button[type=submit]").click();
  await dialog.waitFor({ state: "detached", timeout: 10_000 });
  await until(async () => {
    const c = await sqChannel(rig, ch.name);
    return c?.pid === root && c.channel_order === a;
  }, "the dialog put it back after a");
}

async function remove(rig, admin, watcher, ch) {
  const { page } = admin;
  await rig.sq.cmd("clientmove", { clid: watcher.clid, cid: ch.cid });
  await until(
    async () =>
      page.evaluate(
        async ({ clid, cid }) => {
          const { useTsStore } = await import("/src/stores/ts.ts");
          return useTsStore().clients.get(Number(clid))?.channelId === cid;
        },
        { clid: watcher.clid, cid: ch.cid },
      ),
    "the admin sees the watcher inside",
  );
  await menu(page, channelRow(page, ch.name), "Delete channel…");
  const confirm = page.locator("[role=dialog][aria-modal=true]", {
    hasText: `Delete channel “${ch.name}”?`,
  });
  await confirm.locator(".message", { hasText: "1 client(s)" }).waitFor({ timeout: 5_000 });
  await confirm.locator("button.danger", { hasText: "Delete" }).click();
  await until(async () => (await sqChannel(rig, ch.name)) === null, "the server deleted it");
  await channelRow(watcher.page, ch.name).waitFor({ state: "detached", timeout: 10_000 });
  const [info] = await rig.sq.cmd("clientinfo", { clid: watcher.clid });
  assert.notEqual(info.cid, ch.cid, "the watcher was moved out, still connected");
}

async function permsLoaded(page) {
  await until(
    () =>
      page.evaluate(async () => {
        const { usePermsStore } = await import("/src/stores/perms.ts");
        const p = usePermsStore();
        return p.loaded && p.has("b_channel_create_child");
      }),
    "the admin's permissions are in",
  );
}

export default async function m2Channels(rig) {
  const admin = await rig.connect("chadmin", { channel: "a", admin: true });
  const watcher = await rig.connect("watcher", { channel: "b" });
  await permsLoaded(admin.page);

  const ch = await create(rig, admin, watcher);
  rig.log("create ok");
  await joinWithPassword(rig, watcher, ch);
  rig.log("join with password ok");
  await edit(rig, admin, watcher, ch);
  rig.log("edit ok");
  await move(rig, admin, watcher, ch);
  rig.log("move ok");
  await moveByDialog(rig, admin, ch);
  rig.log("move dialog ok");
  await remove(rig, admin, watcher, ch);
  rig.log("delete ok");
}
