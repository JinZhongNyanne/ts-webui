/**
 * Short-lived, read-only tokens that stand in for the session id in asset
 * URLs (icons, avatars, TTS audio). A leaked URL then only ever reveals a
 * credential that expires on its own and cannot drive the session.
 */
import { randomBytes } from "node:crypto";
import type { AssetTokenGrant } from "@jinz/protocol";

/** How long a minted token stays valid. */
export const ASSET_TOKEN_TTL_MS = 900_000;
/** How often a session is handed a fresh token; well inside the TTL. */
export const ASSET_TOKEN_ROTATE_MS = 600_000;
/** Live tokens kept per session; minting beyond this evicts the oldest. */
export const MAX_LIVE_PER_SESSION = 4;

/** 24 random bytes as base64url is always exactly 32 characters. */
const TOKEN_BYTES = 24;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

interface TokenEntry {
  readonly sessionId: string;
  readonly expiresAt: number;
}

export class AssetTokenStore {
  private tokens: ReadonlyMap<string, TokenEntry> = new Map();

  constructor(private readonly now: () => number = Date.now) {}

  /** Issues a new token for the session; earlier tokens stay valid until expiry. */
  mint(sessionId: string): AssetTokenGrant {
    this.sweep();
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = this.now() + ASSET_TOKEN_TTL_MS;
    const next = new Map(this.tokens);
    next.set(token, { sessionId, expiresAt });
    this.tokens = evictBeyondCap(next, sessionId);
    return { token, expiresAt };
  }

  /** The session id behind a live token, or undefined when unknown, malformed or expired. */
  resolve(token: string | undefined): string | undefined {
    if (typeof token !== "string" || !TOKEN_SHAPE.test(token)) return undefined;
    const entry = this.tokens.get(token);
    if (!entry || entry.expiresAt <= this.now()) return undefined;
    return entry.sessionId;
  }

  /** Invalidates every token the session holds, live or not. */
  revokeSession(sessionId: string): void {
    this.tokens = new Map([...this.tokens].filter(([, e]) => e.sessionId !== sessionId));
  }

  /** Drops expired entries so the map only ever grows with live tokens. */
  sweep(): void {
    const now = this.now();
    this.tokens = new Map([...this.tokens].filter(([, e]) => e.expiresAt > now));
  }

  get size(): number {
    return this.tokens.size;
  }
}

/**
 * Keeps at most MAX_LIVE_PER_SESSION tokens for the session, dropping the
 * oldest first. Map iteration is insertion-ordered, so the first entries seen
 * are the oldest mints.
 */
function evictBeyondCap(
  tokens: ReadonlyMap<string, TokenEntry>,
  sessionId: string,
): ReadonlyMap<string, TokenEntry> {
  const owned = [...tokens].filter(([, e]) => e.sessionId === sessionId);
  const excess = owned.length - MAX_LIVE_PER_SESSION;
  if (excess <= 0) return tokens;
  const evicted = new Set(owned.slice(0, excess).map(([token]) => token));
  return new Map([...tokens].filter(([token]) => !evicted.has(token)));
}
