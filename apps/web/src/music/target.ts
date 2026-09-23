import { MUSIC_BOT_DEFAULT_PORT } from "@jinz/protocol";

/** Bare IPv6 literals need brackets before a port can follow. */
function bracketHost(host: string): string {
  const h = host.trim();
  if (h.includes(":") && !h.startsWith("[")) return `[${h}]`;
  return h;
}

/** Where the hub dials when no explicit music bot is given: the TeamSpeak host on the bot's default port. */
export function defaultMusicBot(host: string): string {
  return `${bracketHost(host)}:${MUSIC_BOT_DEFAULT_PORT}`;
}

/** The address the hub actually tries: the user's explicit value, or the default derived from the host. */
export function describeMusicBot(explicit: string, host: string): string {
  const e = explicit.trim();
  return e || defaultMusicBot(host);
}
