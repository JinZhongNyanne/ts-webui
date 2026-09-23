import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { OfflineMessageHead } from "../ts/admin-rows";

let pending: ((list: OfflineMessageHead[]) => void) | null = null;
const names: Record<string, string | null> = { "a=": "alice" };
const lookups: string[][] = [];

vi.mock("../ts/admin-actions", () => ({
  listOfflineMessages: vi.fn(
    () =>
      new Promise<OfflineMessageHead[]>((resolve) => {
        pending = resolve;
      }),
  ),
  namesFromUids: vi.fn(async (uids: readonly string[]) => {
    lookups.push([...uids]);
    return Object.fromEntries(uids.map((u) => [u, names[u] ?? null]));
  }),
}));

const { useInboxStore } = await import("./inbox");

const head = (id: string, read = false): OfflineMessageHead => ({
  id,
  fromUid: "a=",
  subject: `s${id}`,
  at: 0,
  read,
});

beforeEach(() => {
  setActivePinia(createPinia());
  pending = null;
  lookups.length = 0;
});

describe("inbox store", () => {
  it("counts unread and patches read / deleted messages", async () => {
    const inbox = useInboxStore();
    const done = inbox.refresh();
    pending!([head("1"), head("2"), head("3", true)]);
    await done;
    expect(inbox.unread).toBe(2);
    inbox.markRead("1");
    inbox.remove("2");
    expect(inbox.unread).toBe(0);
    expect(inbox.messages.map((m) => m.id)).toEqual(["1", "3"]);
  });

  it("drops a list that arrives after a reset (the session ended)", async () => {
    const inbox = useInboxStore();
    const done = inbox.refresh();
    inbox.reset();
    pending!([head("1")]);
    await done;
    expect(inbox.messages).toEqual([]);
  });

  it("resolves sender names in one lookup, leaving unknown ones empty", async () => {
    const inbox = useInboxStore();
    await inbox.resolveNames(["a=", "b=", "a="]);
    expect(inbox.names).toEqual({ "a=": "alice", "b=": "" });
    expect(lookups).toEqual([["a=", "b="]]);
  });

  it("never asks twice for the same sender, even while a lookup is under way", async () => {
    const inbox = useInboxStore();
    await Promise.all([inbox.resolveNames(["a=", "b="]), inbox.resolveNames(["b=", "c="])]);
    await inbox.resolveNames(["a=", "c="]);
    expect(lookups).toEqual([["a=", "b="], ["c="]]);
    expect(inbox.names).toEqual({ "a=": "alice", "b=": "", "c=": "" });
  });

  it("forgets a failed lookup, so the next one may try again", async () => {
    const { namesFromUids } = await import("../ts/admin-actions");
    vi.mocked(namesFromUids).mockRejectedValueOnce(new Error("offline"));
    const inbox = useInboxStore();
    await inbox.resolveNames(["a="]);
    expect(inbox.names).toEqual({});
    await inbox.resolveNames(["a="]);
    expect(inbox.names).toEqual({ "a=": "alice" });
  });

  it("rechecks after a while away, counting any fetch as a check", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(0);
      const inbox = useInboxStore();
      const first = inbox.refresh();
      pending!([]);
      await first;
      inbox.noteAway();
      vi.setSystemTime(4 * 60_000);
      expect(inbox.recheckDue()).toBe(false);
      inbox.noteAway();
      vi.setSystemTime(11 * 60_000);
      expect(inbox.recheckDue()).toBe(true);
      // A fetch that fails still counts, so a busy hub is not asked again at once.
      const failed = inbox.refresh();
      inbox.noteAway();
      vi.setSystemTime(17 * 60_000);
      expect(inbox.recheckDue()).toBe(false);
      pending!([]);
      await failed;
      inbox.reset();
      inbox.noteAway();
      vi.setSystemTime(60 * 60_000);
      expect(inbox.recheckDue()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
