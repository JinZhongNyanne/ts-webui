/**
 * The display name of a chat conversation.
 *
 * Both shells need it — the dock puts it on a panel tab, the mobile shell on a
 * chip — so the mapping from a conversation key to a name lives here rather
 * than in either of them. Lookups are injected so this stays free of the store.
 */
import { t } from "../i18n";
import type { ConversationKey } from "../stores/ts";

/** How to resolve the ids inside a conversation key. */
export interface ConversationNameLookups {
  readonly channelName: (id: string) => string | undefined;
  readonly clientName: (id: number) => string | undefined;
}

/**
 * Names a conversation key, falling back to a generic label when the channel or
 * the user behind it is no longer there (they can leave mid-session, and a raw
 * id would mean nothing to the reader).
 */
export function conversationName(
  conversation: ConversationKey,
  lookups: ConversationNameLookups,
): string {
  if (conversation === "server") return t("tree.server");
  if (conversation.startsWith("channel:")) {
    return lookups.channelName(conversation.slice("channel:".length)) ?? t("chat.channel");
  }
  if (conversation.startsWith("client:")) {
    return lookups.clientName(Number(conversation.slice("client:".length))) ?? t("chat.private");
  }
  return t("chat.title");
}
