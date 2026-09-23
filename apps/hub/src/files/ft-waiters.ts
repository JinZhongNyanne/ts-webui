/**
 * Matches file transfer answers to the `ftinitupload` / `ftinitdownload`
 * that asked for them.
 *
 * TeamSpeak answers a transfer init with a notification carrying our
 * `clientftfid`, not with the command's own reply, and in no fixed order: on
 * a live TS3 3.13 server `notifystartupload` / `notifystartdownload` came
 * *after* the command's `error id=0`, a refusal (`notifystatusfiletransfer`
 * with the error id in `status`, and `failed_permid` for a 2568) came before
 * it, and "file already exists" after. So a waiter is registered before the
 * command goes out and settled by whichever notify names its id.
 *
 * The client library numbers its own transfers (icon and avatar downloads)
 * upward from 1, so ours come from the top half of the 16-bit range.
 */
import { TsCommandFailure } from "../gateway/commands.js";

export const FT_ID_FIRST = 32_768;
export const FT_ID_LAST = 65_535;
/** The largest file size a start may announce (1 TiB); anything past it is not a real file. */
export const FT_MAX_FILE_SIZE = 2 ** 40;

/** What the server hands back for a transfer it accepted. */
export interface FtStart {
  serverFtId: number;
  /** The key to present on the file port; a credential for this one transfer. */
  key: string;
  port: number;
  /** Download: the file's size. Upload: the seek position (always 0, we never resume). */
  size: number;
}

/** The server never answered the init. */
export class FtInitTimeout extends Error {
  constructor() {
    super("file transfer init timed out");
    this.name = "FtInitTimeout";
  }
}

/**
 * The server's start made no sense: a port outside 1–65535, a size that is
 * negative, fractional or absurd, or no key. The server may be one a user
 * named, and the hub dials that port and passes that size on as a
 * Content-Length, so nothing out of range is used.
 */
export class FtBadStart extends Error {
  constructor(what: string) {
    super(`file transfer start with a bad ${what}`);
    this.name = "FtBadStart";
  }
}

interface Waiter {
  resolve: (start: FtStart) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const int = (v: string | undefined) => {
  const n = Number(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

const COUNT = /^\d{1,16}$/;

/** A start notify's fields, range-checked (see FtBadStart). */
function startOf(name: string, params: Record<string, string>): FtStart | FtBadStart {
  const portText = params["port"] ?? "";
  const port = COUNT.test(portText) ? Number(portText) : 0;
  if (port < 1 || port > 65_535) return new FtBadStart("port");
  // Absent is 0 (an upload always starts there); present, it must be a count.
  const sizeText = (name === "notifystartdownload" ? params["size"] : params["seekpos"]) ?? "0";
  const size = COUNT.test(sizeText) ? Number(sizeText) : -1;
  if (size < 0 || size > FT_MAX_FILE_SIZE) return new FtBadStart("size");
  const key = params["ftkey"] ?? "";
  if (!key) return new FtBadStart("key");
  return { serverFtId: int(params["serverftfid"]), key, port, size };
}

export class FtWaiters {
  private readonly waiters = new Map<number, Waiter>();

  constructor(private nextId = FT_ID_FIRST) {}

  /** Reserves an id; `promise` settles with the server's answer or after `timeoutMs`. */
  register(timeoutMs: number): { id: number; promise: Promise<FtStart> } {
    const id = this.takeId();
    const promise = new Promise<FtStart>((resolve, reject) => {
      const timer = setTimeout(() => this.cancel(id, new FtInitTimeout()), timeoutMs);
      timer.unref?.();
      this.waiters.set(id, { resolve, reject, timer });
    });
    // A refusal can arrive before the caller awaits (it precedes the command's
    // own answer); that must not count as an unhandled rejection.
    promise.catch(() => undefined);
    return { id, promise };
  }

  /** Feeds one raw command; true when it settled a waiter. */
  onNotify(name: string, params: Record<string, string>): boolean {
    if (
      name !== "notifystartupload" &&
      name !== "notifystartdownload" &&
      name !== "notifystatusfiletransfer"
    ) {
      return false;
    }
    const id = int(params["clientftfid"]);
    const waiter = this.waiters.get(id);
    if (!waiter) return false;
    this.forget(id, waiter);
    if (name === "notifystatusfiletransfer") {
      const permId = int(params["failed_permid"]);
      waiter.reject(
        new TsCommandFailure(
          params["status"] ?? "0",
          params["msg"] ?? "file transfer refused",
          permId > 0 ? permId : null,
        ),
      );
      return true;
    }
    const start = startOf(name, params);
    if (start instanceof FtBadStart) waiter.reject(start);
    else waiter.resolve(start);
    return true;
  }

  /** Gives up on one waiter (its command failed, or the caller went away). */
  cancel(id: number, reason: Error): void {
    const waiter = this.waiters.get(id);
    if (!waiter) return;
    this.forget(id, waiter);
    waiter.reject(reason);
  }

  /** Fails every waiter (the TeamSpeak connection is gone). */
  clear(reason: Error = new Error("connection closed")): void {
    for (const id of [...this.waiters.keys()]) this.cancel(id, reason);
  }

  get size(): number {
    return this.waiters.size;
  }

  private forget(id: number, waiter: Waiter): void {
    clearTimeout(waiter.timer);
    this.waiters.delete(id);
  }

  private takeId(): number {
    const id = this.nextId;
    this.nextId = id >= FT_ID_LAST ? FT_ID_FIRST : id + 1;
    return id;
  }
}
