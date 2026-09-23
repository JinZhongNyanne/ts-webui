/**
 * "Came into view" is not "joined the server". Subscribing to a channel makes
 * the server announce every client in it with the same notification a fresh
 * connection gets; only the from-channel (cfid 0 for a real join) tells them
 * apart. The hub passes that on as `joinedServer`, which is what keeps the
 * sound pack from chiming once per user on every subscribe.
 */
import assert from "node:assert/strict";

export const title = "view vs join: a subscription is not a server join";

async function menu(page, row, label) {
  await row.first().click({ button: "right" });
  const item = page.locator(".cm-item .cm-label", { hasText: label }).first();
  await item.waitFor({ state: "visible", timeout: 5_000 });
  await item.click();
}

function channelRow(page, name) {
  return page.locator(".tree .channel", { hasText: name });
}

/** Collects the hub's `client.entered` messages as the page receives them. */
function recordEntries(page) {
  const seen = [];
  page.on("websocket", (ws) =>
    ws.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes('"client.entered"')) return;
      const msg = JSON.parse(payload);
      seen.push({ nick: msg.client.nickname, joinedServer: msg.joinedServer });
    }),
  );
  return seen;
}

async function waitForEntry(seen, nick) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const hit = seen.find((e) => e.nick === nick);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no client.entered for ${nick}`);
}

export default async function viewVsJoin(rig) {
  const bob = await rig.connect("bob", { channel: "b" });
  const alice = await rig.connect("alice", { channel: "a" });
  const seen = recordEntries(alice.page);
  // The socket already exists; reloading is the simplest way to watch a fresh one.
  await alice.page.reload({ waitUntil: "domcontentloaded" });
  await alice.page.locator("form.dialog button[type=submit]").click({ timeout: 30_000 });
  await rig.waitForClientInTree(alice.page, bob.nick);

  const b = rig.channels.name("b");
  await menu(alice.page, channelRow(alice.page, b), "Unsubscribe from channel");
  await alice.page
    .locator(".tree .client", { hasText: bob.nick })
    .waitFor({ state: "detached", timeout: 10_000 });
  seen.length = 0;
  await menu(alice.page, channelRow(alice.page, b), "Subscribe to channel");
  const viewed = await waitForEntry(seen, bob.nick);
  assert.equal(
    viewed.joinedServer,
    false,
    "a subscription brings bob into view, not onto the server",
  );

  const carol = await rig.connect("carol", { channel: "b" });
  const joined = await waitForEntry(seen, carol.nick);
  assert.equal(joined.joinedServer, true, "a fresh connection is a server join");
}
