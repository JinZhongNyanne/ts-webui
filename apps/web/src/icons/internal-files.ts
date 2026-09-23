/**
 * Avatars and icons in channel 0 over the transfer core (stores/transfers.ts)
 * and `ts.cmd`. The hub only takes our own avatar and `icon_<id>` files there
 * (see isInternalUploadPath).
 *
 * These are small and a dialog waits on them, so they go in as "internal"
 * transfers: ahead of the queue, outside the parallel limit and out of the
 * file browser's list. A signal cancels one (the dialogs' Cancel button).
 */
import { ICON_DIR, iconFilePath, type TsCmdArgs, type TsCmdName } from "@jinz/protocol";
import { t } from "../i18n";
import { CANCELLED, FileTransferError } from "../files/http";
import { useTransfersStore } from "../stores/transfers";
import { tsCommand } from "../ts/commands";
import type { AvatarIo } from "../avatar/avatar-file";
import { iconCommand, iconIdsFromListing, type IconTarget } from "./icon-set";

const INTERNAL = "0";
/** TeamSpeak's "file already exists". */
const TS_FILE_EXISTS = "2050";

/**
 * Uploads `file` to channel 0's root under its own name; `overwrite` replaces
 * what is there. Rejects with the transfer's (translated) failure, as a
 * FileTransferError carrying the server's code.
 */
async function uploadInternalFile(
  file: File,
  overwrite: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const transfers = useTransfersStore();
  const id = transfers.uploadFile(INTERNAL, "/", file, { overwrite, origin: "internal", signal });
  const done = await transfers.waitFor(id);
  if (done.state === "done") return;
  if (done.state === "cancelled") throw new FileTransferError(CANCELLED, t("ft.cancelled"));
  throw new FileTransferError(done.code ?? "failed", done.error ?? t("ft.failed"));
}

/** What avatar-file.ts's actions run on. */
export const avatarIo: AvatarIo = {
  upload: (file, signal) => uploadInternalFile(file, true, signal),
  command: <C extends TsCmdName>(cmd: C, args: TsCmdArgs<C>) => tsCommand(cmd, args),
};

/** The uploaded icons (needs b_icon_manage). */
export async function listIcons(): Promise<number[]> {
  return iconIdsFromListing(await useTransfersStore().listFiles(INTERNAL, ICON_DIR));
}

/** Uploads icon `bytes` as `iconId` (the CRC-32 of the bytes, see icon-upload.ts). */
export async function uploadIcon(
  bytes: Uint8Array,
  type: string,
  iconId: number,
  signal?: AbortSignal,
): Promise<void> {
  const name = iconFilePath(iconId).slice(1);
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name, { type });
  try {
    // Never replaced (the hub refuses it): the same id is the same bytes.
    await uploadInternalFile(file, false, signal);
  } catch (err) {
    // 2050 "file exists": the icon is there already, which is what we wanted.
    if (!(err instanceof FileTransferError) || err.code !== TS_FILE_EXISTS) throw err;
  }
}

export async function deleteIcon(iconId: number): Promise<void> {
  await tsCommand("ftdeleteicon", { iconId: iconId >>> 0 });
}

/** Sets `iconId` on `target`, or removes its icon (`null`). */
export async function setIcon(target: IconTarget, iconId: number | null): Promise<void> {
  const { cmd, args } = iconCommand(target, iconId === null ? null : iconId >>> 0);
  // The union is built per command; TS cannot correlate cmd and args on its own.
  await (tsCommand as (c: TsCmdName, a: unknown) => Promise<unknown>)(cmd, args);
}
