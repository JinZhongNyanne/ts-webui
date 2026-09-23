/**
 * The M1 self-service actions, each one allow-listed `ts.cmd` (see
 * commands.ts). They go through the command channel rather than the older
 * `setNickname` / `setAway` hub messages because those only ever answer with a
 * generic error event: a dialog needs its own command's failure, translated
 * ("nickname already in use", "insufficient permissions (needs …)"), to show
 * under the field that caused it. Every function rejects with a
 * TsCommandError whose message is ready to display.
 *
 * Results arrive the usual way afterwards: the server's `client.updated` /
 * `channel.updated` changes the tree, so nothing here patches the store.
 */
import { batches } from "./client-features";
import { tsCommand } from "./commands";

export async function changeNickname(nickname: string): Promise<void> {
  await tsCommand("clientupdate", { client_nickname: nickname.trim() });
}

/** Going back online also clears the message, as the native client does. */
export async function setAwayStatus(away: boolean, message = ""): Promise<void> {
  await tsCommand("clientupdate", {
    client_away: away,
    client_away_message: away ? message.trim() : "",
  });
}

/** Only meaningful where the channel needs talk power (see needsTalkPower). */
export async function requestTalkPower(message: string): Promise<void> {
  await tsCommand("clientupdate", {
    client_talk_request: true,
    client_talk_request_msg: message.trim(),
  });
}

export async function cancelTalkRequest(): Promise<void> {
  await tsCommand("clientupdate", { client_talk_request: false, client_talk_request_msg: "" });
}

/** Own (b_client_modify_own_description) or someone else's (b_client_modify_description). */
export async function setDescription(clientId: number, description: string): Promise<void> {
  await tsCommand("clientedit", { clid: clientId, client_description: description });
}

/** Grants or revokes talk power; a grant also answers the client's pending request. */
export async function setTalker(clientId: number, talker: boolean): Promise<void> {
  await tsCommand("clientedit", { clid: clientId, client_is_talker: talker });
}

export async function subscribeChannels(channelIds: readonly string[]): Promise<void> {
  for (const cids of batches(channelIds)) await tsCommand("channelsubscribe", { cids });
}

export async function unsubscribeChannels(channelIds: readonly string[]): Promise<void> {
  for (const cids of batches(channelIds)) await tsCommand("channelunsubscribe", { cids });
}

export async function subscribeAllChannels(): Promise<void> {
  await tsCommand("channelsubscribeall", {});
}

export async function unsubscribeAllChannels(): Promise<void> {
  await tsCommand("channelunsubscribeall", {});
}
