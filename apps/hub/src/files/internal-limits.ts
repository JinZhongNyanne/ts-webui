/**
 * Size caps for channel 0, the server's internal store (icons, avatars).
 *
 * The hub holds these files whole: an icon is buffered on its way up (its
 * name must match its bytes, see icon-upload.ts), and every download is
 * kept in the hub-wide asset cache. So they are capped well below the
 * channel file limit, both ways: what a page may put up, and what the hub
 * takes down from a server where native clients may have put up more.
 */
import { isIconFilePath } from "@jinz/protocol";

/** Largest icon. Native clients' icons are 16×16; Server Admin's i_max_icon_filesize is 8 KiB. */
export const INTERNAL_ICON_MAX_BYTES = 64 * 1024;
/** Largest avatar. TeamSpeak's usual i_client_max_avatar_filesize is 200 000 bytes. */
export const INTERNAL_AVATAR_MAX_BYTES = 1024 * 1024;

/**
 * The largest channel-0 upload to `path` (an icon or the caller's avatar,
 * see isInternalUploadPath): the cap for its kind, or the user's
 * i_client_max_avatar_filesize when the server told us and it is smaller.
 * 0 and -1 are left to the server, which refuses with its own message.
 */
export function internalUploadLimit(path: string, avatarPermBytes: number | undefined): number {
  if (isIconFilePath(path)) return INTERNAL_ICON_MAX_BYTES;
  if (avatarPermBytes !== undefined && avatarPermBytes > 0) {
    return Math.min(INTERNAL_AVATAR_MAX_BYTES, avatarPermBytes);
  }
  return INTERNAL_AVATAR_MAX_BYTES;
}
