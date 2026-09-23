import { describe, expect, it } from "vitest";
import { INBOX_RECHECK_AWAY_MS, INBOX_RECHECK_GAP_MS, InboxRecheck } from "./inbox-recheck";

const MIN = 60_000;

describe("InboxRecheck", () => {
  it("rechecks after the tab was away long enough and the last check is old enough", () => {
    const r = new InboxRecheck();
    r.checked(0);
    r.away(1 * MIN);
    expect(r.back(12 * MIN)).toBe(true);
  });

  it("does not recheck after a short absence", () => {
    const r = new InboxRecheck();
    r.checked(0);
    r.away(20 * MIN);
    expect(r.back(20 * MIN + INBOX_RECHECK_AWAY_MS - 1)).toBe(false);
  });

  it("checks at most once per gap, however often the tab comes back", () => {
    const r = new InboxRecheck();
    r.checked(0);
    r.away(0);
    expect(r.back(INBOX_RECHECK_GAP_MS - 1)).toBe(false);
    r.away(INBOX_RECHECK_GAP_MS);
    expect(r.back(INBOX_RECHECK_GAP_MS + INBOX_RECHECK_AWAY_MS)).toBe(true);
    r.checked(INBOX_RECHECK_GAP_MS + INBOX_RECHECK_AWAY_MS);
    r.away(INBOX_RECHECK_GAP_MS + INBOX_RECHECK_AWAY_MS);
    expect(r.back(INBOX_RECHECK_GAP_MS + 2 * INBOX_RECHECK_AWAY_MS)).toBe(false);
  });

  it("counts the absence from when the tab first went away", () => {
    const r = new InboxRecheck();
    r.checked(0);
    r.away(1 * MIN);
    // Hidden, then blurred as well: still away since the first.
    r.away(10 * MIN);
    expect(r.back(11 * MIN)).toBe(true);
  });

  it("needs an absence first: coming back without going away does nothing", () => {
    const r = new InboxRecheck();
    r.checked(0);
    expect(r.back(60 * MIN)).toBe(false);
  });

  it("forgets the absence once back", () => {
    const r = new InboxRecheck();
    r.checked(0);
    r.away(0);
    expect(r.back(2 * MIN)).toBe(false);
    expect(r.back(30 * MIN)).toBe(false);
  });

  it("never rechecks before a first check (not connected yet)", () => {
    const r = new InboxRecheck();
    r.away(0);
    expect(r.back(60 * MIN)).toBe(false);
  });

  it("starts over after reset (a new session checks on connect)", () => {
    const r = new InboxRecheck();
    r.checked(0);
    r.away(0);
    r.reset();
    expect(r.back(60 * MIN)).toBe(false);
  });
});
