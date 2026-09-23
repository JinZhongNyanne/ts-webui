/**
 * TsSession's side of a transfer init: it spends the hub-wide command budget,
 * sends our own clientftfid, and settles on whichever notify names it (the
 * start after the command's answer, a refusal before it, as a live server
 * does). Driven through a fake driver client, without a handshake.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import pino from "pino";
import type { ServerMessage } from "@jinz/protocol";
import { TsSession } from "../gateway/TsSession.js";
import { TsCommandFailure } from "../gateway/commands.js";
import { clearServerGuards, guardFor } from "../gateway/server-guard.js";

afterEach(() => clearServerGuards());

type Raw = { name: string; params: Record<string, string> };

function session() {
  const logs: string[] = [];
  const ts = new TsSession(
    { host: "ts.test", port: 9987, nickname: "ft", logger: pino({ level: "silent" }) },
    {
      onMessage: (m: ServerMessage) => void (m.type === "log" && logs.push(m.message)),
      onVoice: () => undefined,
      onClosed: () => undefined,
    },
  );
  const sent: string[] = [];
  let answer: (text: string) => Raw[] = () => [];
  const feed = (cmd: Raw) => (ts as unknown as { onRaw(c: Raw): void }).onRaw(cmd);
  const client = {
    execCommandWithResponse: vi.fn(async (text: string) => {
      sent.push(text);
      // Notifies that precede the command's own answer.
      for (const cmd of answer(text)) feed(cmd);
      return [];
    }),
  };
  Object.assign(ts as object, { client });
  return {
    ts,
    sent,
    logs,
    feed,
    answerWith: (fn: (text: string) => Raw[]) => (answer = fn),
    guard: guardFor("ts.test:9987"),
  };
}

const idOf = (text: string) => /clientftfid=(\d+)/.exec(text)![1]!;

describe("TsSession transfer inits", () => {
  it("spend the hub-wide budget and resolve on the start notify that follows", async () => {
    const s = session();
    const slot = vi.spyOn(s.guard, "tsCmdSlot");
    const pending = s.ts.initFileDownload({ cid: "5", path: "/a.txt", cpw: "" });
    await vi.waitFor(() => expect(s.sent).toHaveLength(1));
    expect(slot).toHaveBeenCalledTimes(1);
    expect(s.sent[0]).toMatch(
      /^ftinitdownload clientftfid=\d+ name=\\\/a.txt cid=5 cpw= seekpos=0$/,
    );
    s.feed({
      name: "notifystartdownload",
      params: {
        clientftfid: idOf(s.sent[0]!),
        serverftfid: "3",
        ftkey: "secretkey",
        port: "30033",
        size: "11",
      },
    });
    await expect(pending).resolves.toEqual({
      serverFtId: 3,
      key: "secretkey",
      port: 30033,
      size: 11,
    });
    // The transfer key never reaches the protocol trace.
    expect(s.logs.some((l) => l.includes("secretkey"))).toBe(false);
    expect(s.logs.some((l) => l.includes("ftkey=***"))).toBe(true);
  });

  it("carry a media range's seek position onto the wire, through the same budget", async () => {
    const s = session();
    const slot = vi.spyOn(s.guard, "tsCmdSlot");
    const target = { cid: "5", path: "/v.webm", cpw: "", seekpos: 4096 };
    const pending = s.ts.initFileDownload(target);
    await vi.waitFor(() => expect(s.sent).toHaveLength(1));
    expect(slot).toHaveBeenCalledTimes(1);
    expect(s.sent[0]).toMatch(/ name=\\\/v.webm cid=5 cpw= seekpos=4096$/);
    s.feed({
      name: "notifystartdownload",
      params: { clientftfid: idOf(s.sent[0]!), ftkey: "k", port: "30033", size: "8192" },
    });
    await expect(pending).resolves.toMatchObject({ size: 8192 });
  });

  it("reject with the refusal a status notify brings before the answer", async () => {
    const s = session();
    s.answerWith((text) => [
      {
        name: "notifystatusfiletransfer",
        params: { clientftfid: idOf(text), status: "2568", failed_permid: "236", msg: "no" },
      },
    ]);
    const err = await s.ts
      .initFileUpload({ cid: "5", path: "/a.txt", cpw: "", size: 3, overwrite: false })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TsCommandFailure);
    expect(err).toMatchObject({ id: "2568", failedPermId: 236 });
  });

  it("send nothing while the server is flooding", async () => {
    const s = session();
    s.guard.noteFlood();
    const err = await s.ts
      .initFileDownload({ cid: "5", path: "/a.txt", cpw: "" })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ id: "3331" });
    expect(s.sent).toEqual([]);
  });

  it("refuse a path that fails the checks without spending the budget", async () => {
    const s = session();
    const slot = vi.spyOn(s.guard, "tsCmdSlot");
    await expect(s.ts.initFileDownload({ cid: "5", path: "/../x", cpw: "" })).rejects.toThrow();
    expect(slot).not.toHaveBeenCalled();
  });
});
