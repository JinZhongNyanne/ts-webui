/**
 * The system-log line for a moderation action seen in the tree: someone was
 * kicked from their channel or the server or banned, or we were kicked or
 * moved. The reason ids are TeamSpeak's (see REASON in notify/cues.ts, whose
 * sounds and desktop notifications cover the same events).
 *
 * Our own server kick or ban is not here: the hub reports it as a fatal
 * "kicked" / "banned" error, which already lands in the log with the reason.
 */
import type { ServerMessage, TsClient } from "@jinz/protocol";
import type { MessageKey } from "../i18n";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const MOVED_BY_OTHER = 1;
const CHANNEL_KICK = 4;
const SERVER_KICK = 5;
const BANNED = 6;

/** Someone else leaving at a moderator's hand. */
const LEFT_EVENTS: Partial<Record<number, MessageKey>> = {
  [SERVER_KICK]: "mod.event.clientKickedFromServer",
  [BANNED]: "mod.event.clientBanned",
};

export interface ModerationEvent {
  text: string;
  kind: "info" | "warn";
}

export function moderationEvent(
  msg: ServerMessage,
  client: Pick<TsClient, "nickname" | "isSelf"> | undefined,
  t: Translate,
): ModerationEvent | null {
  if (!client) return null;
  const reason = (text: string | undefined) => (text ? t("mod.reason", { msg: text }) : "");
  if (msg.type === "client.moved") {
    const by = msg.invokerName ?? "";
    if (msg.reasonId === CHANNEL_KICK) {
      const r = reason(msg.reasonMsg);
      return client.isSelf
        ? { kind: "warn", text: t("mod.event.kickedFromChannel", { by, reason: r }) }
        : {
            kind: "info",
            text: t("mod.event.clientKickedFromChannel", { name: client.nickname, by, reason: r }),
          };
    }
    if (msg.reasonId === MOVED_BY_OTHER && client.isSelf && by) {
      return { kind: "info", text: t("mod.event.movedBy", { by }) };
    }
    return null;
  }
  if (msg.type === "client.left" && !client.isSelf) {
    const key = LEFT_EVENTS[msg.reasonId];
    if (!key) return null;
    const by = msg.invokerName ?? "";
    const r = reason(msg.reasonMsg);
    return { kind: "info", text: t(key, { name: client.nickname, by, reason: r }) };
  }
  return null;
}
