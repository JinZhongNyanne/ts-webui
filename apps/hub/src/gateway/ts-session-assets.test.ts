/**
 * TsSession's channel-0 downloads (icons, avatars): capped in bytes and time,
 * cached hub-wide, and an avatar only ever served under the MD5 it names.
 * Driven through a fake driver client, without a handshake.
 */
import { createHash } from "node:crypto";
import type { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { TsClient } from "@jinz/protocol";
import { TsSession } from "./TsSession.js";
import { clearAssetCache } from "./asset-cache.js";
import { avatarPath } from "./avatar.js";
import { clearServerGuards, guardFor, PACE_QUEUE_MAX } from "./server-guard.js";
import { INTERNAL_AVATAR_MAX_BYTES, INTERNAL_ICON_MAX_BYTES } from "../files/internal-limits.js";

afterEach(() => {
  clearServerGuards();
  clearAssetCache();
  vi.useRealTimers();
});

const md5 = (b: Buffer) => createHash("md5").update(b).digest("hex");
const VICTIM = { uid: "AAE=", bytes: Buffer.from("victim picture") };
const ATTACKER = { uid: "AAI=", bytes: Buffer.from("attacker picture") };

/** A session on ts.test:9987 whose server holds `files` (path → bytes). */
function session(files: Record<string, Buffer>, opts: { announce?: (b: Buffer) => number } = {}) {
  const ts = new TsSession(
    { host: "ts.test", port: 9987, nickname: "assets", logger: pino({ level: "silent" }) },
    { onMessage: () => undefined, onVoice: () => undefined, onClosed: () => undefined },
  );
  const client = {
    fileTransferInitDownload: vi.fn(async (_cid: bigint, path: string) => {
      const file = files[path];
      if (!file) throw new Error("file not found");
      const size = BigInt(opts.announce ? opts.announce(file) : file.length);
      return { fileTransferKey: path, size, port: 30033, clientFileTransferID: 1 };
    }),
    downloadFileData: vi.fn(
      (_host: string, info: { fileTransferKey: string }, sink: Writable) =>
        new Promise<void>((resolve, reject) => {
          sink.on("finish", resolve);
          sink.on("error", reject);
          sink.end(files[info.fileTransferKey]);
        }),
    ),
  };
  Object.assign(ts as object, { client, connected: true });
  const clients = (ts as unknown as { clients: Map<number, TsClient> }).clients;
  const addClient = (id: number, uid: string, avatar: string) =>
    clients.set(id, { id, uid, avatar } as TsClient);
  return { ts, client, addClient };
}

describe("TsSession avatars", () => {
  const victimFile = avatarPath(VICTIM.uid)!;
  const attackerFile = avatarPath(ATTACKER.uid)!;
  const hash = md5(VICTIM.bytes);

  it("serve only bytes whose MD5 is the hash, from whichever client holds it", async () => {
    // Someone copies the victim's hash into their own flag and comes first.
    const s = session({ [attackerFile]: ATTACKER.bytes, [victimFile]: VICTIM.bytes });
    s.addClient(2, ATTACKER.uid, hash);
    s.addClient(3, VICTIM.uid, hash);
    expect(await s.ts.fetchAvatar(hash)).toEqual(VICTIM.bytes);
    // Cached under the hash: another look downloads nothing.
    s.client.fileTransferInitDownload.mockClear();
    expect(await s.ts.fetchAvatar(hash.toUpperCase())).toEqual(VICTIM.bytes);
    expect(s.client.fileTransferInitDownload).not.toHaveBeenCalled();
  });

  it("remember a hash no file matches, for every session on the server", async () => {
    const files = { [attackerFile]: ATTACKER.bytes };
    const a = session(files);
    a.addClient(2, ATTACKER.uid, hash);
    expect(await a.ts.fetchAvatar(hash)).toBeNull();
    expect(a.client.fileTransferInitDownload).toHaveBeenCalledTimes(1);
    const b = session(files);
    b.addClient(2, ATTACKER.uid, hash);
    expect(await b.ts.fetchAvatar(hash)).toBeNull();
    expect(b.client.fileTransferInitDownload).not.toHaveBeenCalled();
  });

  it("forget a mismatch after a short while (an upload may just not be announced yet)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const files: Record<string, Buffer> = { [victimFile]: ATTACKER.bytes };
    const s = session(files);
    s.addClient(3, VICTIM.uid, hash);
    expect(await s.ts.fetchAvatar(hash)).toBeNull();
    files[victimFile] = VICTIM.bytes;
    vi.setSystemTime(Date.now() + 2 * 60_000);
    expect(await s.ts.fetchAvatar(hash)).toEqual(VICTIM.bytes);
  });

  it("need an MD5 flag and someone in view holding it", async () => {
    const s = session({ [victimFile]: VICTIM.bytes });
    s.addClient(3, VICTIM.uid, "not-an-md5");
    expect(await s.ts.fetchAvatar("not-an-md5")).toBeNull();
    expect(await s.ts.fetchAvatar(md5(Buffer.from("nobody")))).toBeNull();
    expect(s.client.fileTransferInitDownload).not.toHaveBeenCalled();
  });

  it("try a bounded number of holders", async () => {
    const s = session({});
    for (let i = 1; i <= 10; i++) s.addClient(i, Buffer.from([i]).toString("base64"), hash);
    expect(await s.ts.fetchAvatar(hash)).toBeNull();
    expect(s.client.fileTransferInitDownload).toHaveBeenCalledTimes(3);
  });
});

describe("TsSession channel-0 downloads", () => {
  it("skip a file announced bigger than its kind may be", async () => {
    const path = "/icon_5000";
    const s = session({ [path]: Buffer.alloc(INTERNAL_ICON_MAX_BYTES + 1) });
    expect(await s.ts.fetchIcon(5000)).toBeNull();
    expect(s.client.downloadFileData).not.toHaveBeenCalled();
  });

  it("cut off a file that sends more than it announced", async () => {
    const big = Buffer.alloc(INTERNAL_AVATAR_MAX_BYTES + 10, 7);
    const path = avatarPath(VICTIM.uid)!;
    const s = session({ [path]: big }, { announce: () => 10 });
    s.addClient(3, VICTIM.uid, md5(big));
    expect(await s.ts.fetchAvatar(md5(big))).toBeNull();
    expect(s.client.downloadFileData).toHaveBeenCalledTimes(1);
  });

  it("give up on a download that never ends", async () => {
    vi.useFakeTimers();
    const s = session({ "/icon_5000": Buffer.from("x") });
    s.client.downloadFileData.mockImplementation(() => new Promise<void>(() => undefined));
    const pending = s.ts.fetchIcon(5000);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(pending).resolves.toBeNull();
  });

  it("refuse, without caching, when the hub-wide pace queue is full", async () => {
    const s = session({ "/icon_5000": Buffer.from("x") });
    const guard = guardFor("ts.test:9987");
    // Without the spacing sleeps, so draining the queue costs no real time.
    Object.assign(guard as object, {
      clock: { now: () => Date.now(), sleep: async () => undefined },
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const held = Array.from({ length: PACE_QUEUE_MAX }, () =>
      guard.paced(() => gate, { optional: true }),
    );
    expect(await s.ts.fetchIcon(5000)).toBeNull();
    expect(s.client.fileTransferInitDownload).not.toHaveBeenCalled();
    release();
    await Promise.all(held);
    expect(await s.ts.fetchIcon(5000)).toEqual(Buffer.from("x"));
  });
});
