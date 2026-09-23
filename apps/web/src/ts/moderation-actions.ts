/**
 * The M2 moderation actions, each one allow-listed `ts.cmd` (see commands.ts),
 * in the style of client-actions.ts: every function rejects with a
 * TsCommandError whose message is ready to show, and the result arrives the
 * usual way afterwards (the server's notifies move the client, change its
 * groups...), so nothing here patches the store.
 */
import { KICK_FROM_CHANNEL, KICK_FROM_SERVER } from "@jinz/protocol";
import { TsCommandError, tsCommand } from "./commands";

/** Moves anyone, ourselves included; the hub hashes the password. */
export async function moveClient(
  clientId: number,
  channelId: string,
  password = "",
): Promise<void> {
  await tsCommand("clientmove", {
    clid: clientId,
    cid: channelId,
    ...(password ? { cpw: password } : {}),
  });
}

export type KickScope = "channel" | "server";

/** A channel kick drops them in the default channel; a server kick disconnects them. */
export async function kickClient(clientId: number, scope: KickScope, reason = ""): Promise<void> {
  const reasonmsg = reason.trim();
  await tsCommand("clientkick", {
    clid: clientId,
    reasonid: scope === "channel" ? KICK_FROM_CHANNEL : KICK_FROM_SERVER,
    ...(reasonmsg ? { reasonmsg } : {}),
  });
}

/**
 * TeamSpeak's answers for adding a group the client already has ("duplicate
 * entry") and removing one it does not have ("empty result set"), checked on
 * a live TS3 server.
 */
const TS_GROUP_DUPLICATE = "2561";
const TS_GROUP_EMPTY_RESULT = "2563";

/**
 * Server groups belong to the identity (database id), not to the connection.
 * Resolves "unchanged" when the client already was (or was not) in the group:
 * the result the caller asked for holds, only our copy of the client lagged.
 */
export async function setServerGroup(
  databaseId: string,
  groupId: string,
  member: boolean,
): Promise<"changed" | "unchanged"> {
  try {
    await tsCommand(member ? "servergroupaddclient" : "servergroupdelclient", {
      sgid: groupId,
      cldbid: databaseId,
    });
    return "changed";
  } catch (err) {
    const already = member ? TS_GROUP_DUPLICATE : TS_GROUP_EMPTY_RESULT;
    if (err instanceof TsCommandError && err.code === already) return "unchanged";
    throw err;
  }
}

/** A client has exactly one channel group per channel; this replaces it. */
export async function setChannelGroup(
  databaseId: string,
  channelId: string,
  groupId: string,
): Promise<void> {
  await tsCommand("setclientchannelgroup", { cgid: groupId, cid: channelId, cldbid: databaseId });
}

/**
 * Turns a talk request down. TeamSpeak has no command of its own for that:
 * clearing the talker flag also clears a pending request and its message
 * (checked on a live TS3 server; `clientedit client_talk_request=0` is
 * refused as an invalid parameter). It is what revoking sends, too.
 */
export async function denyTalkRequest(clientId: number): Promise<void> {
  await tsCommand("clientedit", { clid: clientId, client_is_talker: false });
}

/** Our own channel commander flag (b_client_use_channel_commander). */
export async function setChannelCommander(on: boolean): Promise<void> {
  await tsCommand("clientupdate", { client_is_channel_commander: on });
}
