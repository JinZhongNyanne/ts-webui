import { describe, expect, it } from "vitest";
import { FT_MEDIA_TICKET_TTL_MS } from "@jinz/protocol";
import {
  MAX_MEDIA_TICKETS_PER_SESSION,
  MediaTickets,
  NotMediaError,
  type MediaRequest,
} from "./media-tickets.js";

const OWNER = { ts: "one" };

const request = (sessionId: string, path = "/clip.webm", owner: object = OWNER): MediaRequest => ({
  sessionId,
  owner,
  host: "10.0.0.1",
  cid: "5",
  path,
  cpw: "pw",
  size: 1_000,
});

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

function store(now?: () => number) {
  const revoked: string[] = [];
  const tickets = new MediaTickets((t) => revoked.push(t), now);
  return { tickets, revoked };
}

describe("MediaTickets", () => {
  it("mint url-safe tickets naming one file, typed by its name", () => {
    const c = clock();
    const { tickets } = store(c.now);
    const { ticket, expiresAt, grant } = tickets.mint(request("s1", "/dir/片段.webm"));
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(expiresAt).toBe(1_000 + FT_MEDIA_TICKET_TTL_MS);
    expect(grant).toMatchObject({
      sessionId: "s1",
      cid: "5",
      path: "/dir/片段.webm",
      name: "片段.webm",
      type: "video/webm",
      size: 1_000,
    });
  });

  it("work many times, not once", () => {
    const { tickets } = store();
    const { ticket } = tickets.mint(request("s1"));
    expect(tickets.get(ticket)?.path).toBe("/clip.webm");
    expect(tickets.get(ticket)?.path).toBe("/clip.webm");
    expect(tickets.get(ticket)?.path).toBe("/clip.webm");
  });

  it("expire after ten minutes, and say so", () => {
    const c = clock();
    const { tickets, revoked } = store(c.now);
    const { ticket } = tickets.mint(request("s1"));
    c.advance(FT_MEDIA_TICKET_TTL_MS - 1);
    expect(tickets.get(ticket)).toBeDefined();
    c.advance(1);
    expect(tickets.get(ticket)).toBeUndefined();
    expect(revoked).toEqual([ticket]);
    expect(tickets.size).toBe(0);
  });

  it("are never minted for anything but video or audio", () => {
    const { tickets } = store();
    for (const path of ["/a.html", "/a.svg", "/a.txt", "/a.mp4.html", "/noext"]) {
      expect(() => tickets.mint(request("s1", path)), path).toThrow(NotMediaError);
    }
    expect(tickets.size).toBe(0);
  });

  it("are never minted for a path that is not one file", () => {
    const { tickets } = store();
    for (const path of ["/", "/../a.webm", "a.webm", "/a/../b.webm", "/a//b.webm"]) {
      expect(() => tickets.mint(request("s1", path)), path).toThrow();
    }
    expect(tickets.size).toBe(0);
  });

  it("replace the session's earlier ticket for the same file", () => {
    const { tickets, revoked } = store();
    const first = tickets.mint(request("s1")).ticket;
    const second = tickets.mint(request("s1")).ticket;
    expect(tickets.get(first)).toBeUndefined();
    expect(tickets.get(second)).toBeDefined();
    expect(revoked).toEqual([first]);
  });

  it("leave other files, and other sessions' tickets for the same file, alone", () => {
    const { tickets, revoked } = store();
    const mine = tickets.mint(request("s1")).ticket;
    const other = tickets.mint(request("s1", "/other.webm")).ticket;
    const theirs = tickets.mint(request("s2")).ticket;
    const sameNameOtherChannel = tickets.mint({ ...request("s1"), cid: "6" }).ticket;
    for (const t of [mine, other, theirs, sameNameOtherChannel]) {
      expect(tickets.get(t)).toBeDefined();
    }
    expect(revoked).toEqual([]);
  });

  it("are capped per session, dropping the oldest", () => {
    const { tickets, revoked } = store();
    const minted = Array.from(
      { length: MAX_MEDIA_TICKETS_PER_SESSION + 1 },
      (_, i) => tickets.mint(request("s1", `/v${i}.webm`)).ticket,
    );
    const theirs = tickets.mint(request("s2")).ticket;
    expect(revoked).toEqual([minted[0]]);
    expect(tickets.get(minted[0])).toBeUndefined();
    expect(minted.slice(1).every((t) => tickets.get(t) !== undefined)).toBe(true);
    expect(tickets.get(theirs)).toBeDefined();
  });

  it("are revoked with their session", () => {
    const { tickets, revoked } = store();
    const mine = tickets.mint(request("s1")).ticket;
    const theirs = tickets.mint(request("s2")).ticket;
    tickets.revokeSession("s1");
    expect(tickets.get(mine)).toBeUndefined();
    expect(tickets.get(theirs)).toBeDefined();
    expect(revoked).toEqual([mine]);
  });

  it("are revoked when the caller says their session no longer holds", () => {
    const { tickets, revoked } = store();
    const stale = tickets.mint(request("s1", "/a.webm", { ts: "old connection" })).ticket;
    const live = tickets.mint(request("s1", "/b.webm")).ticket;
    tickets.revokeUnless((grant) => grant.owner === OWNER);
    expect(tickets.get(stale)).toBeUndefined();
    expect(tickets.get(live)).toBeDefined();
    expect(revoked).toEqual([stale]);
  });

  it("can be revoked one at a time, which is said once", () => {
    const { tickets, revoked } = store();
    const { ticket } = tickets.mint(request("s1"));
    tickets.revoke(ticket);
    tickets.revoke(ticket);
    expect(tickets.get(ticket)).toBeUndefined();
    expect(revoked).toEqual([ticket]);
  });

  it("refuse anything not shaped like a ticket without looking", () => {
    const { tickets } = store();
    tickets.mint(request("s1"));
    for (const t of [
      undefined,
      "",
      "x",
      "../../etc/passwd",
      "a".repeat(33),
      "a".repeat(31) + "!",
    ]) {
      expect(tickets.get(t)).toBeUndefined();
    }
  });

  it("sweep what has expired", () => {
    const c = clock();
    const { tickets, revoked } = store(c.now);
    const { ticket } = tickets.mint(request("s1"));
    c.advance(FT_MEDIA_TICKET_TTL_MS);
    tickets.sweep();
    expect(tickets.size).toBe(0);
    expect(revoked).toEqual([ticket]);
  });
});
