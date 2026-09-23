import { describe, expect, it, vi } from "vitest";
import {
  applyBadge,
  badgeCount,
  INITIAL_BADGE_STATE,
  noteMessages,
  noteReturned,
  type BadgeMessage,
} from "./badge";

function msg(id: number, conversation: string, self = false): BadgeMessage {
  return { id, conversation, self };
}

describe("badgeCount", () => {
  it("is zero with nothing unread and nothing missed, so the badge is cleared", () => {
    expect(badgeCount(new Map(), INITIAL_BADGE_STATE)).toBe(0);
  });

  it("adds up every conversation's unread messages", () => {
    const unread = new Map([
      ["server", 2],
      ["client:7", 3],
    ]);
    expect(badgeCount(unread, INITIAL_BADGE_STATE)).toBe(5);
  });

  it("includes messages missed in the open conversation while the app was away", () => {
    const unread = new Map([["channel:1", 1]]);
    expect(badgeCount(unread, { lastSeenId: 9, missed: 2 })).toBe(3);
  });

  it("never shows a negative or fractional count, whatever the inputs", () => {
    expect(badgeCount(new Map([["server", -4]]), { lastSeenId: 0, missed: -1 })).toBe(0);
    expect(badgeCount(new Map([["server", Number.NaN]]), { lastSeenId: 0, missed: 1.7 })).toBe(1);
  });
});

describe("noteMessages", () => {
  const history = [msg(1, "server"), msg(2, "channel:1"), msg(3, "server"), msg(4, "server", true)];

  it("counts only other people's new messages in the open conversation while away", () => {
    const next = noteMessages(INITIAL_BADGE_STATE, history, "server", true);
    // 1 and 3 are someone else's in the open conversation; 4 is our own, and
    // 2 is in another conversation, which the store already counts as unread.
    expect(next).toEqual({ lastSeenId: 4, missed: 2 });
  });

  it("counts nothing while the app is in front of the user, but still moves on", () => {
    expect(noteMessages(INITIAL_BADGE_STATE, history, "server", false)).toEqual({
      lastSeenId: 4,
      missed: 0,
    });
  });

  it("does not count the same message twice", () => {
    const once = noteMessages(INITIAL_BADGE_STATE, history, "server", true);
    const again = noteMessages(once, [...history, msg(5, "server")], "server", true);
    expect(again).toEqual({ lastSeenId: 5, missed: 3 });
  });

  it("forgets what was missed when the conversation history is cleared on disconnect", () => {
    expect(noteMessages({ lastSeenId: 9, missed: 4 }, [], "server", true)).toEqual({
      lastSeenId: 9,
      missed: 0,
    });
  });

  it("returns the same state object when nothing changed", () => {
    const state = { lastSeenId: 4, missed: 1 };
    expect(noteMessages(state, history, "server", true)).toBe(state);
  });
});

describe("noteReturned", () => {
  it("clears what was missed once the user is back", () => {
    expect(noteReturned({ lastSeenId: 7, missed: 3 })).toEqual({ lastSeenId: 7, missed: 0 });
  });

  it("returns the same state when there was nothing to clear", () => {
    const state = { lastSeenId: 7, missed: 0 };
    expect(noteReturned(state)).toBe(state);
  });
});

describe("applyBadge", () => {
  function fakeBadge() {
    return {
      setAppBadge: vi.fn((_count?: number) => Promise.resolve()),
      clearAppBadge: vi.fn(() => Promise.resolve()),
    };
  }

  it("sets the badge to the count", async () => {
    const badge = fakeBadge();
    expect(await applyBadge(badge, 4)).toBe("set");
    expect(badge.setAppBadge).toHaveBeenCalledWith(4);
    expect(badge.clearAppBadge).not.toHaveBeenCalled();
  });

  it("clears the badge rather than showing a zero", async () => {
    const badge = fakeBadge();
    expect(await applyBadge(badge, 0)).toBe("cleared");
    expect(badge.clearAppBadge).toHaveBeenCalledOnce();
    expect(badge.setAppBadge).not.toHaveBeenCalled();
  });

  it("does nothing on a browser without the Badging API", async () => {
    expect(await applyBadge(undefined, 3)).toBe("unsupported");
    expect(await applyBadge({}, 3)).toBe("unsupported");
  });

  it("reports a rejected call instead of letting it reach the app", async () => {
    const log = vi.fn();
    const badge = { ...fakeBadge(), setAppBadge: () => Promise.reject(new Error("NotAllowed")) };
    expect(await applyBadge(badge, 2, log)).toBe("failed");
    expect(log).toHaveBeenCalledOnce();
  });

  it("survives a call that throws synchronously", async () => {
    const badge = {
      ...fakeBadge(),
      clearAppBadge: () => {
        throw new Error("SecurityError");
      },
    };
    expect(await applyBadge(badge, 0, () => undefined)).toBe("failed");
  });
});
