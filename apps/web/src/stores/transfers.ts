/**
 * Channel file transfers (M3): one queue of uploads and downloads, with
 * progress, cancel and at most MAX_PARALLEL running at once (the hub allows
 * each session HUB_FT_MAX_TRANSFERS_PER_SESSION, 3 by default).
 *
 *   const transfers = useTransfersStore();
 *   const id = transfers.uploadFile(cid, "/", file, { overwrite: false });
 *   const done = await transfers.waitFor(id); // done.state: done | failed | cancelled
 *   transfers.downloadFile(cid, "/docs/a.pdf");
 *   const blob = await transfers.fetchFile(cid, "/a.png", { maxBytes }); // previews
 *   const entries = await transfers.listFiles(cid, "/docs");
 *   const link = await transfers.mediaLink(cid, "/clip.webm"); // null: fetch it whole
 *
 * Channel passwords default to the one the ts store knows to be right for
 * the channel (ts/channel-passwords.ts); pass `cpw` to use another. One the
 * server accepts is remembered there, a remembered one it refuses is
 * forgotten (it was changed), a refused guess is never kept.
 *
 * Uploads go through XHR for progress; a download asks the hub for a one-use
 * link and hands it to the browser, whose own download UI shows the
 * progress, so here it is "done" as soon as the browser has it. The hub
 * counts that download against the session until its stream ends, and
 * answers "busy" when the session has no slot left: such a transfer goes
 * back in line and is tried again a little later, never failed. Everything
 * still waiting or running fails when the TeamSpeak session goes away.
 *
 * A media link (video and audio, see chat/files/media-link.ts) is not a
 * transfer in this line at all: the hub only hands out the address, and the
 * player itself streams from it, a range at a time, for as long as it is on
 * screen. Hubs that predate media links say nothing of them in `hello`, and
 * `mediaLink` then answers null so the caller falls back on fetching whole.
 */
import { computed, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import {
  FT_HUB_CODES,
  formatBytes,
  ftNameOf,
  normalizeFtFilePath,
  type FtDownloadRequest,
  type FtEntry,
  type FtLimits,
  type FtMediaTicket,
} from "@jinz/protocol";
import { t } from "../i18n";
import { listFiles as listFilesCmd, getFileInfo as getFileInfoCmd } from "../files/api";
import * as http from "../files/http";
import { CANCELLED, FileTransferError } from "../files/http";
import { checkUpload, uploadLimit, uploadTarget } from "../files/upload-check";
import { requestMediaLink } from "../chat/files/media-link";
import {
  EMPTY_QUEUE,
  cancelTransfer,
  clearFinished as clearDone,
  deferTransfer,
  enqueue,
  failTransfer,
  finishTransfer,
  isFinished,
  nextToStart,
  progressTransfer,
  sizeTransfer,
  startTransfer,
  type NewTransfer,
  type Transfer,
  type TransferOrigin,
  type TransferQueue,
} from "../files/transfer-queue";
import { useTsStore } from "./ts";
import { usePermsStore } from "./perms";

/** Transfers this page runs at once (internal ones aside, see transfer-queue.ts). */
export const MAX_PARALLEL = 2;
/** How long a transfer the hub had no slot for waits before it asks again (ms). */
export const BUSY_RETRY_MS = [1_000, 2_000, 4_000, 8_000] as const;
/** Refusals that mean "not now" rather than "no". */
const RETRY_CODES: ReadonlySet<string> = new Set([
  FT_HUB_CODES.busy,
  FT_HUB_CODES.rateLimited,
  "http_429",
]);
/** TeamSpeak's "wrong channel password". */
const TS_BAD_PASSWORD = "781";

export interface UploadOptions {
  /** Channel password; defaults to the one known for the channel. */
  cpw?: string;
  /** Replace a file of the same name (otherwise the server refuses: 2050). */
  overwrite?: boolean;
  /** Store under this name instead of the file's own. */
  name?: string;
  /** Who asks (see transfer-queue.ts); "browser" by default. */
  origin?: TransferOrigin;
  /** Aborting it cancels the transfer. */
  signal?: AbortSignal;
}

export interface FetchOptions {
  cpw?: string;
  /** Larger files are refused before a byte is fetched. */
  maxBytes: number;
}

/** What the store needs from the rest of the app (an interface so tests can fake it). */
export interface TransferContext {
  sessionId(): string;
  limits(): FtLimits | undefined;
  /** `i_ft_quota_mb_upload_per_client`, undefined when the server did not say. */
  quotaMb(): number | undefined;
  /** The known-good password of a channel ("" when none). */
  channelPassword(cid: string): string;
  /** Keeps a password the server accepted. */
  rememberPassword(cid: string, password: string): void;
  /** Drops a known password the server refused. */
  forgetPassword(cid: string): void;
  /** Registers what to do when the TeamSpeak session ends. */
  onSessionGone(fn: () => void): void;
  now(): number;
  http: Pick<
    typeof http,
    "uploadFile" | "requestDownloadLink" | "startBrowserDownload" | "fetchDownload"
  >;
  /** Asks the hub for a media link; chat/files/media-link.ts's by default. */
  requestMediaLink?: (sessionId: string, req: FtDownloadRequest) => Promise<FtMediaTicket>;
}

/** The per-transfer data that stays out of the reactive list. */
interface Job {
  file?: Blob;
  cpw: string;
  overwrite: boolean;
  abort: AbortController;
  /** Busy answers so far (picks the next wait). */
  retries: number;
  /** For fetchFile: the size limit, and where the bytes go. */
  fetch?: { maxBytes: number; blob?: Blob };
}

function retryDelay(retries: number): number {
  return BUSY_RETRY_MS[Math.min(retries, BUSY_RETRY_MS.length - 1)]!;
}

export function createTransfersStore(ctx: TransferContext) {
  return () => {
    const queue = shallowRef<TransferQueue>(EMPTY_QUEUE);
    const jobs = new Map<string, Job>();
    const waiters = new Map<string, Array<(t: Transfer) => void>>();
    let seq = 0;

    const items = computed(() => queue.value.items);
    const active = computed(() => items.value.filter((t) => !isFinished(t)));
    /** What the file browser shows: the transfers started there, not chat's or an avatar. */
    const listed = computed(() => items.value.filter((t) => t.origin === "browser"));
    const listedActive = computed(() => listed.value.filter((t) => !isFinished(t)));
    const uploadLimitBytes = computed(() =>
      uploadLimit(ctx.limits()?.maxUploadBytes, ctx.quotaMb()),
    );
    const parallel = () => Math.min(MAX_PARALLEL, ctx.limits()?.maxTransfers ?? MAX_PARALLEL);

    function set(next: TransferQueue): void {
      if (next === queue.value) return;
      queue.value = next;
      for (const [id, fns] of waiters) {
        const item = next.items.find((x) => x.id === id);
        if (!item || !isFinished(item)) continue;
        waiters.delete(id);
        for (const fn of fns) fn(item);
      }
    }

    /** Queues a transfer, or records it as failed at once when `problem` (or no job) says so. */
    function add(
      item: Omit<NewTransfer, "id">,
      job: Omit<Job, "abort" | "retries"> | null,
      problem?: string,
      signal?: AbortSignal,
    ): string {
      const id = `ft${++seq}`;
      set(enqueue(queue.value, { ...item, id }));
      if (problem !== undefined || !job) {
        set(failTransfer(queue.value, id, problem ?? t("ft.failed"), ctx.now()));
        return id;
      }
      jobs.set(id, { ...job, abort: new AbortController(), retries: 0 });
      signal?.addEventListener("abort", () => cancel(id), { once: true });
      if (signal?.aborted) cancel(id);
      else pump();
      return id;
    }

    /** Queues `file` for folder `dir` of channel `cid`; returns the transfer id. */
    function uploadFile(cid: string, dir: string, file: File, opts: UploadOptions = {}): string {
      const path = uploadTarget(dir, opts.name ?? file.name);
      const base = { kind: "upload" as const, cid, size: file.size, origin: opts.origin };
      if (!path) return add({ ...base, path: dir, name: file.name }, null, t("ft.badName"));
      const limit = uploadLimitBytes.value;
      const problem =
        checkUpload(file.size, limit) === "tooLarge"
          ? t("ft.tooLarge", { max: formatBytes(limit) })
          : undefined;
      const job = { file, cpw: opts.cpw ?? ctx.channelPassword(cid), overwrite: !!opts.overwrite };
      return add({ ...base, path, name: ftNameOf(path) }, job, problem, opts.signal);
    }

    /** Queues a download of `path` in channel `cid`; returns the transfer id. */
    function downloadFile(
      cid: string,
      path: string,
      cpw?: string,
      origin: TransferOrigin = "browser",
    ): string {
      const clean = normalizeFtFilePath(path);
      const base = { kind: "download" as const, cid, size: 0, origin };
      if (!clean) return add({ ...base, path, name: ftNameOf(path) }, null, t("ft.badName"));
      const job = { cpw: cpw ?? ctx.channelPassword(cid), overwrite: false };
      return add({ ...base, path: clean, name: ftNameOf(clean) }, job);
    }

    /**
     * A small file's bytes (a chat image preview), fetched through the hub
     * in the same line as every other transfer. Rejects with a translated
     * message.
     */
    async function fetchFile(cid: string, path: string, opts: FetchOptions): Promise<Blob> {
      const clean = normalizeFtFilePath(path);
      if (!clean) throw new Error(t("ft.badName"));
      const into: NonNullable<Job["fetch"]> = { maxBytes: opts.maxBytes };
      const job = { cpw: opts.cpw ?? ctx.channelPassword(cid), overwrite: false, fetch: into };
      const base = { kind: "download" as const, cid, size: 0, origin: "chat" as const };
      const id = add({ ...base, path: clean, name: ftNameOf(clean) }, job);
      const done = await waitFor(id);
      if (done.state !== "done" || !into.blob) throw new Error(done.error ?? t("ft.failed"));
      return into.blob;
    }

    function pump(): void {
      for (const next of nextToStart(queue.value, parallel(), ctx.now())) void run(next);
    }

    /** Moves the bytes of `item`; throws a FileTransferError when it does not happen. */
    async function perform(item: Transfer, job: Job): Promise<void> {
      if (item.kind === "upload") {
        await ctx.http.uploadFile({
          sessionId: ctx.sessionId(),
          cid: item.cid,
          path: item.path,
          cpw: job.cpw,
          overwrite: job.overwrite,
          file: job.file!,
          signal: job.abort.signal,
          onProgress: (loaded) => set(progressTransfer(queue.value, item.id, loaded)),
        });
        return;
      }
      const link = await ctx.http.requestDownloadLink(ctx.sessionId(), {
        cid: item.cid,
        path: item.path,
        ...(job.cpw ? { cpw: job.cpw } : {}),
      });
      // The server took the password even if nothing else comes of it.
      ctx.rememberPassword(item.cid, job.cpw);
      // Cancelled while the link was on its way: let it expire unused.
      if (job.abort.signal.aborted) throw new FileTransferError(CANCELLED, t("ft.cancelled"));
      set(sizeTransfer(queue.value, item.id, link.size));
      if (!job.fetch) return ctx.http.startBrowserDownload(link.url, link.name);
      if (link.size > job.fetch.maxBytes) {
        const max = formatBytes(job.fetch.maxBytes);
        throw new FileTransferError(FT_HUB_CODES.tooLarge, t("ft.tooLarge", { max }));
      }
      job.fetch.blob = await ctx.http.fetchDownload(link.url, job.abort.signal);
    }

    async function run(item: Transfer): Promise<void> {
      const job = jobs.get(item.id);
      if (!job) return;
      set(startTransfer(queue.value, item.id, ctx.now()));
      let keep = false;
      try {
        await perform(item, job);
        if (item.kind === "upload") ctx.rememberPassword(item.cid, job.cpw);
        set(finishTransfer(queue.value, item.id, ctx.now()));
      } catch (err) {
        const code = err instanceof FileTransferError ? err.code : undefined;
        if (code === CANCELLED || job.abort.signal.aborted) return;
        if (code !== undefined && RETRY_CODES.has(code)) {
          keep = true;
          const delay = retryDelay(job.retries++);
          set(deferTransfer(queue.value, item.id, ctx.now() + delay));
          setTimeout(pump, delay);
          return;
        }
        if (code === TS_BAD_PASSWORD && job.cpw && job.cpw === ctx.channelPassword(item.cid)) {
          ctx.forgetPassword(item.cid);
        }
        const message = err instanceof Error ? err.message : t("ft.failed");
        set(failTransfer(queue.value, item.id, message, ctx.now(), code));
      } finally {
        if (!keep) jobs.delete(item.id);
        pump();
      }
    }

    function cancel(id: string): void {
      jobs.get(id)?.abort.abort();
      jobs.delete(id);
      set(cancelTransfer(queue.value, id, ctx.now()));
      pump();
    }

    /** Resolves once transfer `id` is done, failed or cancelled. */
    function waitFor(id: string): Promise<Transfer> {
      const item = queue.value.items.find((x) => x.id === id);
      if (!item) return Promise.reject(new Error(`no transfer ${id}`));
      if (isFinished(item)) return Promise.resolve(item);
      return new Promise((resolve) => waiters.set(id, [...(waiters.get(id) ?? []), resolve]));
    }

    /** Whether the hub hands out range-capable media links (FtLimits.mediaStreaming). */
    const mediaStreaming = computed(() => ctx.limits()?.mediaStreaming === true);

    /**
     * A streaming link to video or audio file `path` of channel `cid`, or
     * null when this hub has none to give (the caller then fetches it whole).
     * Passwords are kept and forgotten as for a download. Rejects with a
     * FileTransferError whose message is translated.
     */
    async function mediaLink(
      cid: string,
      path: string,
      cpw?: string,
    ): Promise<FtMediaTicket | null> {
      if (!mediaStreaming.value) return null;
      const clean = normalizeFtFilePath(path);
      if (!clean) throw new FileTransferError(FT_HUB_CODES.badRequest, t("ft.badName"));
      const password = cpw ?? ctx.channelPassword(cid);
      const ask = ctx.requestMediaLink ?? requestMediaLink;
      try {
        const link = await ask(ctx.sessionId(), {
          cid,
          path: clean,
          ...(password ? { cpw: password } : {}),
        });
        ctx.rememberPassword(cid, password);
        return link;
      } catch (err) {
        const code = err instanceof FileTransferError ? err.code : undefined;
        if (code === TS_BAD_PASSWORD && password && password === ctx.channelPassword(cid)) {
          ctx.forgetPassword(cid);
        }
        throw err;
      }
    }

    function clearFinished(): void {
      set(clearDone(queue.value));
    }

    ctx.onSessionGone(() => {
      const reason = t("ft.disconnected");
      let next = queue.value;
      for (const item of queue.value.items) {
        jobs.get(item.id)?.abort.abort();
        next = failTransfer(next, item.id, reason, ctx.now());
      }
      jobs.clear();
      set(next);
    });

    /** Folder `path` of channel `cid` (see files/api.ts), with the known password. */
    function listFiles(cid: string, path = "/", cpw?: string): Promise<FtEntry[]> {
      return listFilesCmd(cid, path, cpw ?? ctx.channelPassword(cid));
    }

    function fileInfo(cid: string, path: string, cpw?: string) {
      return getFileInfoCmd(cid, path, cpw ?? ctx.channelPassword(cid));
    }

    return {
      items,
      active,
      listed,
      listedActive,
      /** The largest upload this user may start now (bytes; Infinity when unknown). */
      uploadLimitBytes,
      uploadFile,
      downloadFile,
      fetchFile,
      mediaStreaming,
      mediaLink,
      cancel,
      waitFor,
      clearFinished,
      listFiles,
      fileInfo,
    };
  };
}

export const useTransfersStore = defineStore("transfers", () => {
  const ts = useTsStore();
  const perms = usePermsStore();
  return createTransfersStore({
    sessionId: () => ts.sessionId,
    limits: () => ts.features.files,
    quotaMb: () => perms.values["i_ft_quota_mb_upload_per_client"],
    channelPassword: (cid) => ts.channelPasswordFor(cid),
    rememberPassword: (cid, password) => ts.rememberChannelPassword(cid, password),
    forgetPassword: (cid) => ts.forgetChannelPassword(cid),
    onSessionGone: (fn) =>
      watch(
        () => ts.connState,
        (state) => state !== "connected" && fn(),
      ),
    now: () => Date.now(),
    http,
  })();
});
