/**
 * Single-use download links.
 *
 * A download has to work from a plain link (`<a href download>`, a
 * navigation), which cannot carry the `x-session-id` header. Rather than put
 * the session's asset token in that URL, which reads any file of any channel
 * the session can see for 15 minutes, the page first asks for one file
 * (`POST /api/files/download-ticket`, with the header), the hub starts that
 * transfer on the TeamSpeak server, and the link names only that transfer:
 *  - one use, then it is gone (a URL copied into chat or a log is dead);
 *  - FT_TICKET_TTL_MS, under the ~10 s TeamSpeak waits for the file port;
 *  - the channel password stays on the hub, never in a URL;
 *  - it only works while the session that asked is still connected.
 */
import { randomBytes } from "node:crypto";
import { FT_TICKET_TTL_MS } from "@jinz/protocol";
import type { FtStart } from "./ft-waiters.js";

/** Live links one session may hold; minting beyond this drops the oldest. */
export const MAX_TICKETS_PER_SESSION = 8;

/** 24 random bytes as base64url: always 32 characters. */
const TICKET_BYTES = 24;
const TICKET_SHAPE = /^[A-Za-z0-9_-]{32}$/;

/** What a ticket stands for: a transfer the server already accepted. */
export interface DownloadGrant {
  readonly sessionId: string;
  /** Where the file port is dialled (see TsSession.fileTransferHost). */
  readonly host: string;
  /** The file's name, for Content-Disposition. */
  readonly name: string;
  readonly start: FtStart;
}

interface Entry {
  readonly grant: DownloadGrant;
  readonly expiresAt: number;
}

export class DownloadTickets {
  private entries: ReadonlyMap<string, Entry> = new Map();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = FT_TICKET_TTL_MS,
  ) {}

  /** How long a ticket lives (ms). */
  get ttl(): number {
    return this.ttlMs;
  }

  mint(grant: DownloadGrant): { ticket: string; expiresAt: number } {
    this.sweep();
    const ticket = randomBytes(TICKET_BYTES).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    const owned = [...this.entries].filter(([, e]) => e.grant.sessionId === grant.sessionId);
    const evicted = new Set(
      owned.slice(0, Math.max(0, owned.length - MAX_TICKETS_PER_SESSION + 1)).map(([t]) => t),
    );
    this.entries = new Map([
      ...[...this.entries].filter(([t]) => !evicted.has(t)),
      [ticket, { grant, expiresAt }],
    ]);
    return { ticket, expiresAt };
  }

  /** The grant behind a live ticket, which is used up by this call. */
  take(ticket: string | undefined): DownloadGrant | undefined {
    if (typeof ticket !== "string" || !TICKET_SHAPE.test(ticket)) return undefined;
    const entry = this.entries.get(ticket);
    if (!entry) return undefined;
    this.entries = new Map([...this.entries].filter(([t]) => t !== ticket));
    return entry.expiresAt > this.now() ? entry.grant : undefined;
  }

  revokeSession(sessionId: string): void {
    this.entries = new Map([...this.entries].filter(([, e]) => e.grant.sessionId !== sessionId));
  }

  sweep(): void {
    const now = this.now();
    this.entries = new Map([...this.entries].filter(([, e]) => e.expiresAt > now));
  }

  get size(): number {
    return this.entries.size;
  }
}
