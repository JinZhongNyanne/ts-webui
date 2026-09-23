/**
 * Channel file commands (M3) for `ts.cmd`: listing and info (read-only), and
 * the file browser's folder, rename / move and delete commands. Uploads and downloads do
 * not go through `ts.cmd` at all: they are HTTP streams (see files.ts), since
 * their bytes travel over TeamSpeak's file port, not the command channel.
 *
 * `cpw` is the channel password in clear; the hub hashes it the way the
 * client protocol wants for file commands too (checked on a live TS3 3.13
 * server: the plain text is refused with 781). Holders of b_ft_ignore_password
 * (Server Admin by default) get in with any password.
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";
import { FtChannelPasswordSchema, FtFilePathSchema, FtPathSchema } from "./files.js";

const channelIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");

/**
 * The channel of a file-browser write. Channel 0 is not a channel but the
 * server's own files: avatars (whose owner the server does not check) and
 * icons. Those have their own guarded commands (ts-icon-commands.ts), so the
 * generic create / rename / delete never reach them. Listing channel 0 stays
 * allowed: the icon manager reads `/icons` there.
 */
const userChannelIdSchema = channelIdSchema.refine(
  (cid) => cid !== "0",
  "channel 0 holds avatars and icons",
);

/** Answers with `notifyfilelist` rows (name, size, datetime, type: 0 dir / 1 file). */
export const FtGetFileListArgs = z
  .object({ cid: channelIdSchema, path: FtPathSchema, cpw: FtChannelPasswordSchema.optional() })
  .strict();

/** Answers with one `notifyfileinfo` row (name is the full path, size, datetime). */
export const FtGetFileInfoArgs = z
  .object({ cid: channelIdSchema, name: FtFilePathSchema, cpw: FtChannelPasswordSchema.optional() })
  .strict();

/** Creates folder `dirname` (its whole path); the parent must exist. */
export const FtCreateDirArgs = z
  .object({
    cid: userChannelIdSchema,
    dirname: FtFilePathSchema,
    cpw: FtChannelPasswordSchema.optional(),
  })
  .strict();

/** `newname` is `oldname` itself or somewhere inside it. */
const intoItself = (oldname: string, newname: string) =>
  newname === oldname || newname.startsWith(`${oldname}/`);

/**
 * Renames or moves a file or folder. Without `tcid` it stays in channel
 * `cid` (the usual rename); with it, it moves to that channel, whose password
 * is `tcpw`. A folder cannot go inside itself. Onto an existing name the
 * server replaces that file without asking (checked on a live 3.13 server):
 * the page must check the listing first.
 */
export const FtRenameFileArgs = z
  .object({
    cid: userChannelIdSchema,
    cpw: FtChannelPasswordSchema.optional(),
    tcid: userChannelIdSchema.optional(),
    tcpw: FtChannelPasswordSchema.optional(),
    oldname: FtFilePathSchema,
    newname: FtFilePathSchema,
  })
  .strict()
  .refine((a) => a.tcid !== undefined || a.tcpw === undefined, {
    message: "tcpw without tcid",
    path: ["tcpw"],
  })
  .refine((a) => (a.tcid !== undefined && a.tcid !== a.cid) || !intoItself(a.oldname, a.newname), {
    message: "cannot move into itself",
    path: ["newname"],
  });

/** The most paths one `ftdeletefile` may name (one command, one budget slot). */
export const FT_DELETE_MAX = 100;

/**
 * Deletes files and folders (a folder with everything in it); one row per
 * path. The server works through them in order and stops at the first it
 * cannot delete, so the page lists again afterwards rather than assuming.
 */
export const FtDeleteFileArgs = z
  .object({
    cid: userChannelIdSchema,
    cpw: FtChannelPasswordSchema.optional(),
    names: z
      .array(FtFilePathSchema)
      .min(1)
      .max(FT_DELETE_MAX)
      .refine((names) => new Set(names).size === names.length, "duplicate paths"),
  })
  .strict();
