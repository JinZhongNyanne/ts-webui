/**
 * Wire form of the transfer commands the file routes send. The routes check
 * their input already; these check again, since a path that slipped through
 * would go straight onto the server's disk.
 */
import { DECIMAL_ID, FtFilePathSchema } from "@jinz/protocol";
import { buildTsCommand } from "../gateway/commands.js";
import { channelPasswordHash } from "../gateway/channel-commands.js";

/** One file in one channel; `cpw` in clear (hashed here, as for ftgetfilelist). */
export interface FtTarget {
  cid: string;
  path: string;
  cpw: string;
}

/**
 * A download, optionally from part-way in: `seekpos` is where the server
 * starts sending (a media range request's first byte; see media-routes.ts).
 * Absent is the start of the file.
 */
export interface FtDownloadTarget extends FtTarget {
  seekpos?: number;
}

export interface FtUploadTarget extends FtTarget {
  size: number;
  overwrite: boolean;
}

const CHANNEL_ID = DECIMAL_ID;

function checked(t: FtTarget): { cid: string; name: string; cpw: string } {
  if (!CHANNEL_ID.test(t.cid)) throw new Error("bad channel id");
  if (!FtFilePathSchema.safeParse(t.path).success) throw new Error("bad file path");
  return { cid: t.cid, name: t.path, cpw: channelPasswordHash(t.cpw) };
}

export function ftInitDownloadText(clientFtId: number, t: FtDownloadTarget): string {
  const { cid, name, cpw } = checked(t);
  const seekpos = t.seekpos ?? 0;
  if (!Number.isSafeInteger(seekpos) || seekpos < 0) throw new Error("bad seek position");
  return buildTsCommand("ftinitdownload", {
    clientftfid: String(clientFtId),
    name,
    cid,
    cpw,
    seekpos: String(seekpos),
  });
}

export function ftInitUploadText(clientFtId: number, t: FtUploadTarget): string {
  const { cid, name, cpw } = checked(t);
  if (!Number.isSafeInteger(t.size) || t.size < 0) throw new Error("bad size");
  return buildTsCommand("ftinitupload", {
    clientftfid: String(clientFtId),
    name,
    cid,
    cpw,
    size: String(t.size),
    overwrite: t.overwrite ? "1" : "0",
    resume: "0",
  });
}

/** Removes what a cancelled upload left behind (see routes.ts). */
export function ftDeleteText(t: FtTarget): string {
  const { cid, name, cpw } = checked(t);
  return buildTsCommand("ftdeletefile", { cid, cpw, name });
}
