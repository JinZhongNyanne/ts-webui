import { describe, expect, it } from "vitest";
import { FT_TICKET_TTL_MS } from "@jinz/protocol";
import { DownloadTickets, MAX_TICKETS_PER_SESSION, type DownloadGrant } from "./tickets.js";

const grant = (sessionId: string, name = "a.txt"): DownloadGrant => ({
  sessionId,
  host: "10.0.0.1",
  name,
  start: { serverFtId: 1, key: "k", port: 30033, size: 5 },
});

function clock(start = 1_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("DownloadTickets", () => {
  it("mints url-safe tickets that expire after the TTL", () => {
    const c = clock();
    const tickets = new DownloadTickets(c.now);
    const { ticket, expiresAt } = tickets.mint(grant("s1"));
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(expiresAt).toBe(1_000 + FT_TICKET_TTL_MS);
  });

  it("works exactly once", () => {
    const tickets = new DownloadTickets();
    const { ticket } = tickets.mint(grant("s1"));
    expect(tickets.take(ticket)?.sessionId).toBe("s1");
    expect(tickets.take(ticket)).toBeUndefined();
  });

  it("refuses an expired ticket", () => {
    const c = clock();
    const tickets = new DownloadTickets(c.now);
    const { ticket } = tickets.mint(grant("s1"));
    c.advance(FT_TICKET_TTL_MS);
    expect(tickets.take(ticket)).toBeUndefined();
  });

  it("refuses malformed and unknown tickets", () => {
    const tickets = new DownloadTickets();
    expect(tickets.take(undefined)).toBeUndefined();
    expect(tickets.take("../../etc")).toBeUndefined();
    expect(tickets.take("A".repeat(32))).toBeUndefined();
  });

  it("drops a session's tickets when it goes", () => {
    const tickets = new DownloadTickets();
    const a = tickets.mint(grant("s1"));
    const b = tickets.mint(grant("s2"));
    tickets.revokeSession("s1");
    expect(tickets.take(a.ticket)).toBeUndefined();
    expect(tickets.take(b.ticket)).toBeDefined();
  });

  it("keeps a bounded number per session, oldest out first", () => {
    const tickets = new DownloadTickets();
    const minted = Array.from({ length: MAX_TICKETS_PER_SESSION + 1 }, (_, i) =>
      tickets.mint(grant("s1", `${i}.txt`)),
    );
    expect(tickets.size).toBe(MAX_TICKETS_PER_SESSION);
    expect(tickets.take(minted[0]!.ticket)).toBeUndefined();
    expect(tickets.take(minted.at(-1)!.ticket)?.name).toBe(`${MAX_TICKETS_PER_SESSION}.txt`);
  });

  it("sweeps expired entries when minting", () => {
    const c = clock();
    const tickets = new DownloadTickets(c.now);
    tickets.mint(grant("s1"));
    c.advance(FT_TICKET_TTL_MS + 1);
    tickets.mint(grant("s2"));
    expect(tickets.size).toBe(1);
  });
});
