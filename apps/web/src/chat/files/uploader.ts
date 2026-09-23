/**
 * Sending a file in chat, the way TS5/TS6 look to the user and TS3 clients
 * can read: the file is uploaded into a channel's file store, then a
 * `[URL=ts3file://…]name[/URL]` message goes to the conversation.
 *
 * Where the file goes:
 * - channel chat: that channel (you can only chat in your own);
 * - private and server chat: your own current channel, because TeamSpeak
 *   has no other place for it. The link then names that channel, and the
 *   other side needs download rights there (and its password, if any).
 *
 * A channel message goes to the channel you are in, so moving while the
 * file is on its way would drop the link into another channel's chat: the
 * message is then not sent at all and the card says where the file is.
 *
 * Inside the channel it goes into `/imgs` or `/files` by what it is
 * (folders.ts), made on first use and fallen back to the channel's root when
 * the user may not create folders, under a name nothing else in that folder
 * has (naming.ts). The link carries the whole path, so a native client opens
 * it from the folder just as it would from the root.
 *
 * The list of uploads in progress is plain data, replaced on every change;
 * the transfer itself (progress, cancel) is the transfers store's.
 *
 * A picture that has just gone out is kept as its own preview: the sender
 * already has the bytes, so their sticker costs nobody a download (see
 * chat/files/previews.ts).
 */
import { sanitizeFtFileName } from "@jinz/protocol";
import type { Transfer } from "../../files/transfer-queue";
import { buildFileMessage } from "./ts3file";
import { PREVIEW_MAX_BYTES } from "./card";
import { imageMimeOf, pastedName, stampedName, uniqueName } from "./naming";
import { CHAT_ROOT_DIR, chatFolderFor, type FolderOutcome } from "./folders";

export type ChatUploadState = "preparing" | "uploading" | "failed";

export interface ChatUpload {
  readonly id: string;
  readonly conversation: string;
  readonly cid: string;
  /** The name it is stored under (known once the folder has been looked at). */
  readonly name: string;
  readonly state: ChatUploadState;
  /** The transfers store's id, once the upload is queued. */
  readonly transferId?: string;
  /** Already translated. */
  readonly error?: string;
}

export interface AttachOptions {
  /** Clipboard data: gets a generated name instead of "image.png". */
  pasted?: boolean;
}

export interface UploaderDeps {
  /** The channel a file for this conversation goes to; null when there is none. */
  channelFor(conversation: string): string | null;
  /** The names in `dir` of the channel; null when it cannot be listed. */
  listNames(cid: string, dir: string): Promise<ReadonlySet<string> | null>;
  /**
   * Makes sure `dir` exists in the channel, creating it once if need be;
   * "unavailable" when the user may not, and the file goes into the root.
   */
  ensureFolder(cid: string, dir: string): Promise<FolderOutcome>;
  /** The channel's name, for the message that says where a file was left. */
  channelName(cid: string): string;
  upload(cid: string, dir: string, file: File, name: string): string;
  waitFor(transferId: string): Promise<Transfer>;
  cancelTransfer(transferId: string): void;
  sendText(conversation: string, text: string): void;
  /** Keeps the bytes just uploaded as the preview of `path` in channel `cid`. */
  keepPreview(cid: string, path: string, file: File): void;
  /** Where native clients find the server (the link's host and port). */
  server(): { host: string; port: number };
  now(): Date;
  /** Translated messages. */
  text(
    key: "noChannel" | "badName" | "tooLong" | "movedAway",
    params?: { channel: string },
  ): string;
}

export interface Uploader {
  attach(conversation: string, file: File, opts?: AttachOptions): Promise<void>;
  cancel(id: string): void;
  dismiss(id: string): void;
}

export function createUploader(
  deps: UploaderDeps,
  get: () => readonly ChatUpload[],
  set: (next: readonly ChatUpload[]) => void,
): Uploader {
  let seq = 0;

  const find = (id: string) => get().find((u) => u.id === id);
  const patch = (id: string, change: Partial<ChatUpload>): void =>
    set(get().map((u) => (u.id === id ? { ...u, ...change } : u)));
  const remove = (id: string): void => set(get().filter((u) => u.id !== id));
  const fail = (id: string, error: string): void =>
    patch(id, { state: "failed", error, transferId: undefined });

  /** The folder a file goes to and the free name it gets there; null when its name is unusable. */
  async function placeFor(
    cid: string,
    file: File,
    opts: AttachOptions,
  ): Promise<{ dir: string; name: string } | null> {
    const at = deps.now();
    const base = opts.pasted ? pastedName(file.type, at) : sanitizeFtFileName(file.name);
    if (!base) return null;
    const wanted = chatFolderFor(base);
    const outcome = await deps.ensureFolder(cid, wanted).catch((): FolderOutcome => "unavailable");
    const dir = outcome === "ready" ? wanted : CHAT_ROOT_DIR;
    const taken = await deps.listNames(cid, dir).catch(() => null);
    return { dir, name: taken ? uniqueName(base, taken) : stampedName(base, at) };
  }

  async function attach(conversation: string, file: File, opts: AttachOptions = {}) {
    const id = `cu${++seq}`;
    const cid = deps.channelFor(conversation);
    const entry: ChatUpload = {
      id,
      conversation,
      cid: cid ?? "",
      name: file.name,
      state: "preparing",
    };
    set([...get(), entry]);
    if (!cid) return fail(id, deps.text("noChannel"));

    const place = await placeFor(cid, file, opts);
    // Cancelled while the folder was being prepared and listed.
    if (!find(id)) return;
    if (!place) return fail(id, deps.text("badName"));

    const transferId = deps.upload(cid, place.dir, file, place.name);
    patch(id, { name: place.name, state: "uploading", transferId });
    const done = await deps.waitFor(transferId);
    if (!find(id) || done.state === "cancelled") return remove(id);
    if (done.state !== "done") return fail(id, done.error ?? "");

    // Still the channel this conversation writes to? (We may have moved.)
    if (deps.channelFor(conversation) !== cid) {
      return fail(id, deps.text("movedAway", { channel: deps.channelName(cid) }));
    }

    const { host, port } = deps.server();
    const message = buildFileMessage({
      host,
      port,
      cid,
      path: done.path,
      size: done.size,
      datetime: Math.floor(deps.now().getTime() / 1000),
    });
    if (!message) return fail(id, deps.text("tooLong"));
    deps.sendText(conversation, message);
    // Only pictures, and only ones small enough for a preview to hold.
    if (imageMimeOf(place.name) && file.size <= PREVIEW_MAX_BYTES) {
      deps.keepPreview(cid, done.path, file);
    }
    remove(id);
  }

  function cancel(id: string): void {
    const transferId = find(id)?.transferId;
    remove(id);
    if (transferId) deps.cancelTransfer(transferId);
  }

  return { attach, cancel, dismiss: remove };
}
