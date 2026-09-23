/**
 * Whether this client may talk in its channel (roadmap D1).
 *
 * The TeamSpeak server drops voice from a client without enough talk power,
 * but it does so silently: without this check the page still lit its own
 * speaking indicator and kept uploading voice nobody would ever hear.
 *
 * The rule is TeamSpeak's: a talker (someone whose talk request was granted)
 * may always talk; anyone else needs at least the channel's needed talk
 * power. Being channel commander grants none — it only changes who hears
 * commander whispers. Whispering is judged by whisper power instead, so it
 * is not gated here (see gate.ts).
 */
import type { TsChannel, TsClient } from "@jinz/protocol";
import { needsTalkPower } from "../ts/client-features";

type TalkState = Pick<TsClient, "talkPower" | "isTalker">;

export function mayTalk(
  self: TalkState | null | undefined,
  channel: Pick<TsChannel, "neededTalkPower"> | null | undefined,
): boolean {
  // Before the snapshot there is nothing to judge by, and nothing is sent anyway.
  if (!self || !channel) return true;
  return !needsTalkPower(self, channel);
}
