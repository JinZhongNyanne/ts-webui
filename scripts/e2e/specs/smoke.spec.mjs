/**
 * The rig's own smoke test: two web clients in the same channel see each
 * other and exchange a channel chat message; an admin client really holds
 * Server Admin. If this fails, no other spec's result means anything.
 */
import assert from "node:assert/strict";

export const title = "smoke: two clients see each other and chat; admin gets Server Admin";

export default async function smoke(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const bob = await rig.connect("bob", { channel: "a" });

  // Each sees the other in its own tree.
  await rig.waitForClientInTree(alice.page, bob.nick);
  await rig.waitForClientInTree(bob.page, alice.nick);

  // Both really sit in the rig's channel, per the server.
  const list = await rig.serverQuery("clientlist");
  for (const c of [alice, bob]) {
    const rec = list.find((r) => r.clid === c.clid);
    assert.equal(rec?.cid, rig.channels.a, `${c.nick} is in ${rig.channels.name("a")}`);
  }

  // Channel chat, both directions.
  const channel = rig.channels.name("a");
  const hello = `hello from alice ${rig.runId}`;
  await rig.sendChannelMessage(alice, hello, channel);
  await rig.waitForChatMessage(bob, hello, channel, alice.nick);
  const reply = `hi alice, bob here ${rig.runId}`;
  await rig.sendChannelMessage(bob, reply, channel);
  await rig.waitForChatMessage(alice, reply, channel, bob.nick);

  // The admin client, via the group the rig applies over ServerQuery.
  const admin = await rig.connect("admin", { channel: "b", admin: true });
  const members = await rig.serverQuery(`servergroupclientlist sgid=${rig.adminGroupId}`);
  assert.ok(
    members.some((m) => m.cldbid === admin.dbId),
    "the admin's identity is in the Server Admin group",
  );
  // And the others see the admin arrive in the neighbouring channel.
  await rig.waitForClientInTree(alice.page, admin.nick);
}
