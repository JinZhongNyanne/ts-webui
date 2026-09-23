/**
 * Files being sent in chat (M3), per conversation: see chat/files/uploader.ts
 * for where they go and what is sent. Progress and cancel come from the
 * transfers store, which runs the actual upload.
 */
import { shallowRef } from "vue";
import { defineStore } from "pinia";
import { t } from "../i18n";
import { createUploader, type ChatUpload } from "../chat/files/uploader";
import { DEFAULT_TS_PORT } from "../chat/files/ts3file";
import { keepPreview } from "../chat/files/previews";
import {
  EMPTY_FOLDERS,
  folderOutcome,
  recallFolder,
  rememberFolder,
  type FolderMemo,
  type FolderOutcome,
} from "../chat/files/folders";
import { createFolder } from "../files/manage";
import { useTsStore } from "./ts";
import { useTransfersStore } from "./transfers";
import { useHubAccessStore } from "./hubAccess";

const TEXT = {
  noChannel: "chatFiles.noChannel",
  badName: "chatFiles.badName",
  tooLong: "chatFiles.tooLong",
  movedAway: "chatFiles.movedAway",
} as const;

export const useChatUploadsStore = defineStore("chatUploads", () => {
  const ts = useTsStore();
  const transfers = useTransfersStore();
  const items = shallowRef<readonly ChatUpload[]>([]);

  /** Channel chat stays in its channel; anything else goes to our own. */
  function channelFor(conversation: string): string | null {
    if (conversation.startsWith("channel:")) return conversation.slice("channel:".length);
    return ts.selfChannel?.id ?? null;
  }

  /**
   * The address native clients know the server by. A hub with a fixed server
   * tells the page its public name (HUB_TS_PUBLIC_ADDRESS, or HUB_TS_SERVER
   * when that is a name); without one the page's own host is the best guess.
   */
  function server(): { host: string; port: number } {
    const access = useHubAccessStore();
    if (access.fixedServer) {
      return access.publicServer ?? { host: location.hostname, port: DEFAULT_TS_PORT };
    }
    return { host: ts.profile.host, port: ts.profile.port || DEFAULT_TS_PORT };
  }

  /**
   * Which of a channel's chat folders this session has already settled. One
   * `ftcreatedir` per channel and folder covers every later upload of that
   * kind, and a user who may not create folders is not asked twice.
   */
  let folders: FolderMemo = EMPTY_FOLDERS;

  async function ensureFolder(cid: string, dir: string): Promise<FolderOutcome> {
    const known = recallFolder(folders, cid, dir);
    if (known) return known;
    let outcome: FolderOutcome;
    try {
      await createFolder(cid, "/", dir.replace(/^\//, ""), ts.channelPasswordFor(cid));
      outcome = "ready";
    } catch (err) {
      outcome = folderOutcome(err as { code?: string });
    }
    folders = rememberFolder(folders, cid, dir, outcome);
    return outcome;
  }

  const uploader = createUploader(
    {
      channelFor,
      ensureFolder,
      listNames: async (cid, dir) =>
        new Set((await transfers.listFiles(cid, dir)).map((e) => e.name)),
      channelName: (cid) => ts.channels.get(cid)?.name ?? cid,
      upload: (cid, dir, file, name) =>
        transfers.uploadFile(cid, dir, file, { name, origin: "chat" }),
      waitFor: (id) => transfers.waitFor(id),
      cancelTransfer: (id) => transfers.cancel(id),
      sendText: (conversation, text) => ts.sendText(conversation, text),
      keepPreview: (cid, path, file) => void keepPreview({ cid, path }, file),
      server,
      now: () => new Date(),
      text: (key, params) => t(TEXT[key], params),
    },
    () => items.value,
    (next) => (items.value = next),
  );

  /** Sends each file; pasted clipboard data gets a generated name. */
  function attach(conversation: string, files: Iterable<File>, pasted = false): void {
    for (const file of files) void uploader.attach(conversation, file, { pasted });
  }

  return {
    items,
    channelFor,
    // Shared with the sticker picker, which puts its pictures in the same folder.
    ensureFolder,
    server,
    attach,
    cancel: uploader.cancel,
    dismiss: uploader.dismiss,
  };
});
