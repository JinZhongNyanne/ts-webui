/**
 * Media links: what lets a `<video>` stream a channel file instead of the page
 * fetching it whole.
 *
 * A download link (tickets.ts) is one use and lives for seconds, which is right
 * for a download and useless for a player: a `<video>` asks again for every
 * seek, with a `Range` header, for as long as it is on screen. So a media link
 * is used many times — and is therefore a longer-lived credential, which is why
 * everything else about it is narrower:
 *  - it names exactly one file (one channel, one normalised path), fixed when
 *    it is minted; nothing in the URL can point it anywhere else;
 *  - only video and audio, typed from the file's *name* (ftMediaMimeOf), so it
 *    can never serve a page, an SVG or a script inline from the hub's origin;
 *  - FT_MEDIA_TICKET_TTL_MS from minting, not from its last use, so a leaked
 *    link dies on schedule however busy it is kept;
 *  - it belongs to one browser session *and* to the TeamSpeak connection that
 *    session had when it was minted (`owner`): a reconnect, or a connection to
 *    another server under the same session, is not that connection, and the
 *    link is dead (the same path on another server is another file);
 *  - a new link for the same file replaces the session's earlier one, and a
 *    session holds at most MAX_MEDIA_TICKETS_PER_SESSION, the oldest dropped;
 *  - the channel password stays here on the hub, never in a URL.
 *
 * Every link that goes, for whatever reason, is reported through `onRevoke`,
 * so the routes can cut a stream it still has running (media-routes.ts).
 */
import { randomBytes } from "node:crypto";
import { FT_MEDIA_TICKET_TTL_MS, FtFilePathSchema, ftMediaMimeOf, ftNameOf } from "@jinz/protocol";

/** Media links one session may hold at once; minting beyond this drops the oldest. */
export const MAX_MEDIA_TICKETS_PER_SESSION = 4;

/** 24 random bytes as base64url: always 32 characters. */
const TICKET_BYTES = 24;
const TICKET_SHAPE = /^[A-Za-z0-9_-]{32}$/;

/** A media link was asked for a file that is not video or audio. */
export class NotMediaError extends Error {
  constructor() {
    super("not a media file");
    this.name = "NotMediaError";
  }
}

/** What the routes know when they mint a link. */
export interface MediaRequest {
  readonly sessionId: string;
  /** The TeamSpeak connection the link is bound to; compared by identity. */
  readonly owner: object;
  /** Where the file port is dialled (see TsSession.fileTransferHost). */
  readonly host: string;
  readonly cid: string;
  readonly path: string;
  /** The channel password in clear; hashed for TeamSpeak by ft-init.ts. */
  readonly cpw: string;
  /** The file's length as the server announced it when the link was minted. */
  readonly size: number;
}

/** What a live link stands for. */
export interface MediaGrant extends MediaRequest {
  readonly name: string;
  /** The type the bytes are served as, from the name alone. */
  readonly type: string;
}

interface Entry {
  readonly grant: MediaGrant;
  readonly expiresAt: number;
}

export class MediaTickets {
  private entries: ReadonlyMap<string, Entry> = new Map();

  constructor(
    private readonly onRevoke: (ticket: string) => void = () => undefined,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = FT_MEDIA_TICKET_TTL_MS,
  ) {}

  /**
   * A link to `request.path`. Throws NotMediaError for a name that is not
   * video or audio, and an Error for a path that is not one normalised file.
   */
  mint(request: MediaRequest): { ticket: string; expiresAt: number; grant: MediaGrant } {
    if (!FtFilePathSchema.safeParse(request.path).success) throw new Error("bad file path");
    const name = ftNameOf(request.path);
    const type = ftMediaMimeOf(name);
    if (!type) throw new NotMediaError();
    this.sweep();
    const grant: MediaGrant = { ...request, name, type };
    const sameFile = (g: MediaGrant) =>
      g.sessionId === grant.sessionId && g.cid === grant.cid && g.path === grant.path;
    this.drop(([, e]) => sameFile(e.grant));
    const owned = [...this.entries].filter(([, e]) => e.grant.sessionId === grant.sessionId);
    const excess = new Set(
      owned.slice(0, Math.max(0, owned.length - MAX_MEDIA_TICKETS_PER_SESSION + 1)).map(([t]) => t),
    );
    this.drop(([t]) => excess.has(t));
    const ticket = randomBytes(TICKET_BYTES).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    this.entries = new Map([...this.entries, [ticket, { grant, expiresAt }]]);
    return { ticket, expiresAt, grant };
  }

  /** The grant behind a live link; unlike a download link it stays live. */
  get(ticket: string | undefined): MediaGrant | undefined {
    if (typeof ticket !== "string" || !TICKET_SHAPE.test(ticket)) return undefined;
    const entry = this.entries.get(ticket);
    if (!entry) return undefined;
    if (entry.expiresAt > this.now()) return entry.grant;
    this.revoke(ticket);
    return undefined;
  }

  revoke(ticket: string): void {
    this.drop(([t]) => t === ticket);
  }

  revokeSession(sessionId: string): void {
    this.drop(([, e]) => e.grant.sessionId === sessionId);
  }

  /** Drops every link whose grant `holds` says no longer holds (its session is gone). */
  revokeUnless(holds: (grant: MediaGrant) => boolean): void {
    this.drop(([, e]) => !holds(e.grant));
  }

  sweep(): void {
    const now = this.now();
    this.drop(([, e]) => e.expiresAt <= now);
  }

  get size(): number {
    return this.entries.size;
  }

  private drop(which: (entry: [string, Entry]) => boolean): void {
    const gone = [...this.entries].filter(which).map(([t]) => t);
    if (gone.length === 0) return;
    const goneSet = new Set(gone);
    this.entries = new Map([...this.entries].filter(([t]) => !goneSet.has(t)));
    for (const ticket of gone) this.onRevoke(ticket);
  }
}
