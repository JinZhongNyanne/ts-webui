/**
 * Who asked for a song.
 *
 * The hub replaces the name the bot gives songs requested from this UI (its
 * own account, or "游客") with the TeamSpeak nickname of whoever requested
 * them. Anything else carries the name the bot has: the bot web UI account
 * that requested it, "游客" for a guest there, or a TeamSpeak chat requester.
 */
export function shownRequester(name: string | undefined | null): string | null {
  const trimmed = name?.trim();
  return trimmed ? trimmed : null;
}
