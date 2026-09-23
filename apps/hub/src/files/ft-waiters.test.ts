import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TsCommandFailure } from "../gateway/commands.js";
import { FT_ID_FIRST, FT_ID_LAST, FT_MAX_FILE_SIZE, FtWaiters } from "./ft-waiters.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("FtWaiters", () => {
  it("hands out ids above the client library's own range, wrapping", () => {
    const w = new FtWaiters();
    const first = w.register(1000);
    expect(first.id).toBe(FT_ID_FIRST);
    expect(w.register(1000).id).toBe(FT_ID_FIRST + 1);
    const wrap = new FtWaiters(FT_ID_LAST);
    expect(wrap.register(1000).id).toBe(FT_ID_LAST);
    expect(wrap.register(1000).id).toBe(FT_ID_FIRST);
    w.clear();
    wrap.clear();
  });

  it("resolves with the start of a download", async () => {
    const w = new FtWaiters();
    const { id, promise } = w.register(1000);
    const handled = w.onNotify("notifystartdownload", {
      clientftfid: String(id),
      serverftfid: "4",
      ftkey: "k/ey",
      port: "30033",
      size: "11",
    });
    expect(handled).toBe(true);
    await expect(promise).resolves.toEqual({ serverFtId: 4, key: "k/ey", port: 30033, size: 11 });
  });

  it("resolves an upload start with its seek position as size", async () => {
    const w = new FtWaiters();
    const { id, promise } = w.register(1000);
    w.onNotify("notifystartupload", {
      clientftfid: String(id),
      serverftfid: "2",
      ftkey: "abc",
      port: "30033",
      seekpos: "0",
    });
    await expect(promise).resolves.toEqual({ serverFtId: 2, key: "abc", port: 30033, size: 0 });
  });

  it("rejects with the status (and the permission) a refusal names", async () => {
    const w = new FtWaiters();
    const { id, promise } = w.register(1000);
    w.onNotify("notifystatusfiletransfer", {
      clientftfid: String(id),
      status: "2568",
      failed_permid: "236",
      msg: "insufficient client permissions (failed on i_ft_needed_file_upload_power)",
    });
    const err = await promise.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TsCommandFailure);
    expect(err).toMatchObject({ id: "2568", failedPermId: 236 });
  });

  it("rejects a start whose port or size is out of range", async () => {
    // A server a user named decides these; the hub dials the port on its own
    // vetted address and sends the size on as Content-Length.
    const bad = [
      { port: "0", size: "1" },
      { port: "65536", size: "1" },
      { port: "", size: "1" },
      { port: "30033", size: "-1" },
      { port: "30033", size: "1.5" },
      { port: "30033", size: String(FT_MAX_FILE_SIZE + 1) },
      { port: "30033", size: "x" },
    ];
    for (const params of bad) {
      const w = new FtWaiters();
      const { id, promise } = w.register(1000);
      w.onNotify("notifystartdownload", {
        clientftfid: String(id),
        serverftfid: "4",
        ftkey: "k",
        ...params,
      });
      const err = await promise.catch((e: unknown) => e);
      expect(err, JSON.stringify(params)).toMatchObject({ name: "FtBadStart" });
    }
    const upload = new FtWaiters();
    const up = upload.register(1000);
    upload.onNotify("notifystartupload", {
      clientftfid: String(up.id),
      ftkey: "k",
      port: "30033",
      seekpos: "-5",
    });
    await expect(up.promise).rejects.toMatchObject({ name: "FtBadStart" });
  });

  it("rejects a start without a key", async () => {
    const w = new FtWaiters();
    const { id, promise } = w.register(1000);
    w.onNotify("notifystartdownload", { clientftfid: String(id), port: "30033", size: "1" });
    await expect(promise).rejects.toMatchObject({ name: "FtBadStart" });
  });

  it("ignores notifies for ids it does not wait for", () => {
    const w = new FtWaiters();
    expect(w.onNotify("notifystartdownload", { clientftfid: "3" })).toBe(false);
    expect(w.onNotify("notifyclientmoved", { clientftfid: String(FT_ID_FIRST) })).toBe(false);
  });

  it("a late status for a transfer already started is ignored", async () => {
    const w = new FtWaiters();
    const { id, promise } = w.register(1000);
    w.onNotify("notifystartupload", {
      clientftfid: String(id),
      serverftfid: "1",
      ftkey: "k",
      port: "1",
    });
    await promise;
    expect(
      w.onNotify("notifystatusfiletransfer", { clientftfid: String(id), status: "2059" }),
    ).toBe(false);
  });

  it("times out", async () => {
    const w = new FtWaiters();
    const { promise } = w.register(500);
    const settled = promise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(501);
    expect(await settled).toMatchObject({ name: "FtInitTimeout" });
    expect(w.size).toBe(0);
  });

  it("cancel and clear drop waiters", async () => {
    const w = new FtWaiters();
    const a = w.register(1000);
    const b = w.register(1000);
    const aErr = a.promise.catch((e: unknown) => e);
    const bErr = b.promise.catch((e: unknown) => e);
    w.cancel(a.id, new Error("gone"));
    expect(((await aErr) as Error).message).toBe("gone");
    w.clear();
    expect(await bErr).toBeInstanceOf(Error);
    expect(w.size).toBe(0);
  });
});
