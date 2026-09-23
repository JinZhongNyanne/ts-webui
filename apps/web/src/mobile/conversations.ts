/**
 * The mobile chat view's conversation list.
 *
 * On the desktop dock every conversation is its own panel, so the dock's panel
 * list *is* the list of open chats. The mobile shell has one chat view and a
 * row of chips instead, so the same list has to be derived from the store:
 * whatever has messages or unread counts, plus the two conversations that are
 * always meaningful — the server, and the channel you are sitting in.
 */

/** Only what the ordering needs; `ChatMessage` in the store satisfies this. */
export interface ConversationMessage {
  readonly conversation: string;
  readonly at: number;
}

export interface ConversationListInput {
  readonly messages: readonly ConversationMessage[];
  readonly unread: ReadonlyMap<string, number>;
  /** The conversation the user is reading; it stays listed even when empty. */
  readonly activeKey: string;
  /** Channel the user is in, if any — its chat is always on offer, as in TS3. */
  readonly selfChannelId?: string;
}

/** One chip in the mobile chat view. */
export interface ConversationEntry {
  readonly key: string;
  readonly unread: number;
}

/** The server chat, which every session has. */
const SERVER = "server";

/**
 * Conversations to offer, in chip order: the server, then your own channel,
 * then everything else by its most recent message (newest first).
 *
 * Returns a fresh array; the inputs are left untouched.
 */
export function openConversations(input: ConversationListInput): ConversationEntry[] {
  const { messages, unread, activeKey, selfChannelId } = input;

  // Most recent message per conversation, which orders the tail of the list.
  const lastAt = new Map<string, number>();
  for (const m of messages) {
    const seen = lastAt.get(m.conversation);
    if (seen === undefined || m.at > seen) lastAt.set(m.conversation, m.at);
  }

  const pinned = [SERVER, ...(selfChannelId ? [`channel:${selfChannelId}`] : [])];
  const rest = [...new Set([...lastAt.keys(), ...unread.keys(), activeKey])]
    .filter((key) => !pinned.includes(key))
    // No message yet (unread-only, or the active conversation) sorts last.
    .sort((a, b) => (lastAt.get(b) ?? 0) - (lastAt.get(a) ?? 0));

  return [...pinned, ...rest].map((key) => ({ key, unread: unread.get(key) ?? 0 }));
}
