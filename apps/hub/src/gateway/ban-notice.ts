/**
 * Being banned while connected. The server tells the banned client with a
 * `notifyclientleftview` about itself, reasonid 6, carrying who did it, the
 * reason and the ban length (`bantime`, seconds, 0 = permanent), then drops
 * the connection. The TeamSpeak library only raises `kicked` for reasons 4
 * and 5, so without this the page would just see the link die and try to
 * reconnect into the ban.
 */
import { encodeTextCode } from "@jinz/protocol";

/** Hub error code for "the server banned us" (next to "kicked"). */
export const BANNED_CODE = "banned";

const REASON_BAN = "6";

/** The fatal error to send for a self `notifyclientleftview`, or null when it is not a ban. */
export function selfBanNotice(
  params: Readonly<Record<string, string>>,
): { code: string; message: string } | null {
  if (params["reasonid"] !== REASON_BAN) return null;
  return {
    code: BANNED_CODE,
    // Seconds rather than text: the page words the duration in its own language.
    message: encodeTextCode("hub.bannedBy", {
      name: params["invokername"] ?? "",
      reason: params["reasonmsg"] ?? "",
      seconds: params["bantime"] ?? "0",
    }),
  };
}
