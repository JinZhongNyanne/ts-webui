/**
 * The TeamSpeak avatar (M3), as native clients handle it (checked on a live
 * TS3 3.13 server, see packages/protocol/src/ts-internal-files.ts): the image
 * goes to channel 0 as `/avatar_<UID in a–p hex>`, then `clientupdate
 * client_flag_avatar=<md5 hex>` tells everyone which version to fetch. The
 * hub caches avatars by that hash, so a new one shows at once.
 *
 * Not the hub-local "profile icon" (stores/profiles.ts), which only other
 * web users see.
 */
import { md5 } from "@noble/hashes/legacy.js";
import { avatarFilePath, type TsCmdArgs, type TsCmdName, type TsCmdRow } from "@jinz/protocol";

/** Side of the saved avatar; native clients show them at up to this size. */
export const AVATAR_MAX_SIDE = 300;
/** i_client_max_avatar_filesize's usual value, for servers that do not tell us. */
export const AVATAR_DEFAULT_LIMIT = 200_000;
/**
 * What the picker takes. Everything is re-encoded as PNG or JPEG, which native
 * TS3 clients display (WebP they do not).
 */
export const AVATAR_ACCEPT = "image/png,image/jpeg,image/gif,image/webp,image/bmp";

/** MD5 of the file in lowercase hex: the value of client_flag_avatar. */
export function avatarHash(bytes: Uint8Array): string {
  return Array.from(md5(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The largest avatar we may upload: i_client_max_avatar_filesize (bytes)
 * within the hub's upload limit. Null when the server allows none (0);
 * unknown or unlimited (-1) falls back to TeamSpeak's usual 200 000.
 */
export function avatarByteLimit(
  permValue: number | undefined,
  hubMax: number | undefined,
): number | null {
  if (permValue === 0) return null;
  const server = permValue === undefined || permValue < 0 ? AVATAR_DEFAULT_LIMIT : permValue;
  return Math.min(server, hubMax ?? Number.POSITIVE_INFINITY);
}

/** Canvas encodings to try in order: PNG (lossless), then ever smaller JPEGs. */
export const ENCODE_ATTEMPTS: readonly { type: string; quality?: number }[] = [
  { type: "image/png" },
  { type: "image/jpeg", quality: 0.92 },
  { type: "image/jpeg", quality: 0.85 },
  { type: "image/jpeg", quality: 0.75 },
  { type: "image/jpeg", quality: 0.6 },
  { type: "image/jpeg", quality: 0.45 },
];

export type Encoder = (type: string, quality?: number) => Promise<Blob | null>;

/** The first encoding that fits in `limit` bytes; null when none does. */
export async function encodeWithinLimit(encode: Encoder, limit: number): Promise<Blob | null> {
  for (const { type, quality } of ENCODE_ATTEMPTS) {
    const blob = await encode(type, quality);
    if (blob && blob.size > 0 && blob.size <= limit) return blob;
  }
  return null;
}

/** What the actions need (the transfers store and ts.cmd; fakes in tests). */
export interface AvatarIo {
  /** Uploads to channel 0's root, replacing the file; rejects with a readable message. */
  upload(file: File, signal?: AbortSignal): Promise<void>;
  command<C extends TsCmdName>(cmd: C, args: TsCmdArgs<C>): Promise<TsCmdRow[]>;
}

/** Uploads `bytes` as `uid`'s avatar, then tells everyone its hash. */
export async function uploadAvatar(
  bytes: Uint8Array,
  type: string,
  uid: string,
  io: AvatarIo,
  signal?: AbortSignal,
): Promise<void> {
  const path = avatarFilePath(uid);
  if (!path) throw new Error("no UID to name the avatar after");
  const file = new File([bytes as Uint8Array<ArrayBuffer>], path.slice(1), { type });
  await io.upload(file, signal);
  await io.command("clientupdate", { client_flag_avatar: avatarHash(bytes) });
}

/**
 * Clears the flag (which is what hides the avatar everywhere), then deletes
 * the file where we may: the server wants b_client_avatar_delete_other even
 * for one's own. A refused delete (2568) only leaves an unused file behind;
 * any other failure is passed on.
 */
export async function removeAvatar(io: AvatarIo, mayDeleteFile: boolean): Promise<void> {
  await io.command("clientupdate", { client_flag_avatar: "" });
  if (!mayDeleteFile) return;
  try {
    await io.command("ftdeleteavatar", {});
  } catch (err) {
    if ((err as { code?: unknown } | null)?.code !== TS_NO_PERMISSION) throw err;
  }
}

/** TeamSpeak's "insufficient client permissions". */
const TS_NO_PERMISSION = "2568";
