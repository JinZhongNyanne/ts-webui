/**
 * Sending a sticker into a conversation.
 *
 * A sticker is a picture on the hub, but TeamSpeak has no idea what a sticker
 * is: what goes out is the ordinary chat-file message native clients already
 * understand (`[URL=ts3file://…]`, see chat/files/ts3file.ts), so a TS3 user
 * sees the picture like any other shared file and our own chat previews it.
 *
 * That means an upload into the channel — and everyone here reaches the
 * server through the hub's one address, so the cheapest upload is the one
 * that does not happen. The file is named after the picture's hash
 * (`sticker_<first12>.<ext>`), which is the same name for everyone, every
 * pack and both scopes, so the second time anyone sends that sticker in that
 * channel the file is already there: the listing is checked first, the upload
 * is skipped, and only the message goes out. Two people sending it at the
 * same moment race, and the loser is told "file exists" (2050) by the server
 * — which is the answer we wanted, so it counts as a hit too.
 *
 * Pure of Vue and of the stores: everything it touches is a dep, so the
 * whole path can be tested, including the one where nothing is uploaded.
 */
import { joinFtPath, stickerFileName, type FtEntry, type Sticker } from "@jinz/protocol";
import type { Transfer } from "../files/transfer-queue";
import { buildFileMessage } from "../chat/files/ts3file";
import {
  CHAT_IMAGE_DIR,
  CHAT_ROOT_DIR,
  TS_FILE_EXISTS,
  type FolderOutcome,
} from "../chat/files/folders";

/** Why a sticker could not be sent; each has an i18n key of its own. */
export type StickerSendError = "noChannel" | "movedAway" | "tooLong" | "failed";

export interface StickerSendResult {
  readonly ok: boolean;
  readonly error?: StickerSendError;
  /** The channel the file was left in, for the "you moved away" message. */
  readonly cid?: string;
  /** False when the channel already had the picture and nothing was uploaded. */
  readonly uploaded: boolean;
}

export interface StickerSenderDeps {
  /** The channel a file for this conversation goes to; null when there is none. */
  channelFor(conversation: string): string | null;
  /** Makes sure the chat picture folder is there; "unavailable" falls back to the root. */
  ensureFolder(cid: string, dir: string): Promise<FolderOutcome>;
  /** What is in `dir` of the channel; null when it cannot be listed. */
  listEntries(cid: string, dir: string): Promise<readonly FtEntry[] | null>;
  /** The picture's bytes from the hub. */
  fetchImage(sticker: Sticker): Promise<Blob>;
  upload(cid: string, dir: string, file: File, name: string): string;
  waitFor(transferId: string): Promise<Transfer>;
  sendText(conversation: string, text: string): void;
  /** Where native clients find the server (the link's host and port). */
  server(): { host: string; port: number };
  now(): Date;
}

export interface StickerSender {
  send(conversation: string, sticker: Sticker): Promise<StickerSendResult>;
}

const fail = (error: StickerSendError, cid?: string): StickerSendResult => ({
  ok: false,
  error,
  uploaded: false,
  ...(cid ? { cid } : {}),
});

/** The channel's own copy of this picture, or null when it has none. */
export function findStickerFile(entries: readonly FtEntry[] | null, name: string): FtEntry | null {
  if (!entries || !name) return null;
  const lower = name.toLowerCase();
  return entries.find((e) => !e.isDir && e.name.toLowerCase() === lower) ?? null;
}

export function createStickerSender(deps: StickerSenderDeps): StickerSender {
  async function send(conversation: string, sticker: Sticker): Promise<StickerSendResult> {
    const cid = deps.channelFor(conversation);
    if (!cid) return fail("noChannel");
    const name = stickerFileName(sticker.hash, sticker.contentType);
    if (!name) return fail("failed");

    // Pictures live in the chat image folder, like every other picture sent here.
    const outcome = await deps
      .ensureFolder(cid, CHAT_IMAGE_DIR)
      .catch((): FolderOutcome => "unavailable");
    const dir = outcome === "ready" ? CHAT_IMAGE_DIR : CHAT_ROOT_DIR;

    const entries = await deps.listEntries(cid, dir).catch(() => null);
    const already = findStickerFile(entries, name);
    let size = already?.size ?? sticker.bytes;
    let datetime = already?.datetime ?? Math.floor(deps.now().getTime() / 1000);
    let uploaded = false;

    if (!already) {
      const put = await upload(cid, dir, sticker, name);
      // Someone else put the same picture there while we were looking: fine.
      if (put.state !== "done" && put.code !== TS_FILE_EXISTS) return fail("failed");
      uploaded = put.state === "done";
      if (uploaded) {
        size = put.size || sticker.bytes;
        datetime = Math.floor(deps.now().getTime() / 1000);
      }
    }

    // Still the channel this conversation writes to? (We may have moved.)
    if (deps.channelFor(conversation) !== cid) return fail("movedAway", cid);

    const { host, port } = deps.server();
    const path = joinFtPath(dir, name);
    if (!path) return fail("failed");
    const message = buildFileMessage({ host, port, cid, path, size, datetime });
    if (!message) return fail("tooLong");
    deps.sendText(conversation, message);
    return { ok: true, uploaded };
  }

  async function upload(
    cid: string,
    dir: string,
    sticker: Sticker,
    name: string,
  ): Promise<{ state: Transfer["state"] | "error"; code?: string; size: number }> {
    try {
      const blob = await deps.fetchImage(sticker);
      const file = new File([blob], name, { type: sticker.contentType });
      // Never replaced: the name is the picture's hash, so it is already these bytes.
      const done = await deps.waitFor(deps.upload(cid, dir, file, name));
      return { state: done.state, code: done.code, size: done.size };
    } catch {
      return { state: "error", size: 0 };
    }
  }

  return { send };
}
