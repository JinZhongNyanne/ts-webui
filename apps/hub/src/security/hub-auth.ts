/**
 * The hub password: one shared secret that lets a browser use this hub at all.
 *
 * Logging in trades the password for a cookie holding a signed pass
 * (`v1.<expiresAt>.<nonce>.<mac>`). The hub keeps no state: a pass is good
 * while its MAC checks out and it has not expired. The MAC key is derived from
 * both HUB_SESSION_SECRET and the password, so changing either one signs
 * everybody out without a list of issued passes to revoke.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const HUB_AUTH_COOKIE = "jinz_hub";
/** A pass lasts a month; logging in again renews it. */
export const HUB_AUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** WebSocket close code for "log in first"; the page shows the password form. */
export const WS_CLOSE_UNAUTHORIZED = 4401;

const VERSION = "v1";

export interface HubAuthOptions {
  /** Empty = no password; every check passes. */
  password: string;
  secret: string;
}

export class HubAuth {
  private readonly key: Buffer | null;
  private readonly passwordDigest: Buffer | null;

  constructor(opts: HubAuthOptions) {
    if (!opts.password) {
      this.key = null;
      this.passwordDigest = null;
      return;
    }
    this.passwordDigest = sha256(opts.password);
    this.key = createHmac("sha256", opts.secret)
      .update("jinz-hub-auth\0")
      .update(opts.password)
      .digest();
  }

  /** Whether this hub asks for a password at all. */
  get required(): boolean {
    return this.key !== null;
  }

  /** Constant-time comparison: hashing both sides first also hides the length. */
  checkPassword(candidate: string): boolean {
    if (!this.passwordDigest) return true;
    return timingSafeEqual(sha256(candidate), this.passwordDigest);
  }

  /** A fresh pass valid until `now + HUB_AUTH_TTL_MS`. */
  issue(now = Date.now()): { value: string; expiresAt: number } {
    const expiresAt = now + HUB_AUTH_TTL_MS;
    const body = `${VERSION}.${expiresAt}.${randomBytes(12).toString("base64url")}`;
    return { value: `${body}.${this.mac(body)}`, expiresAt };
  }

  /** True when no password is set, or `pass` is an unexpired pass this hub signed. */
  verify(pass: string | undefined, now = Date.now()): boolean {
    if (!this.key) return true;
    if (!pass) return false;
    const parts = pass.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) return false;
    const expiresAt = Number(parts[1]);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
    const expected = Buffer.from(this.mac(parts.slice(0, 3).join(".")));
    const given = Buffer.from(parts[3] ?? "");
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private mac(body: string): string {
    // Only reached when a password is set, so the key exists.
    return createHmac("sha256", this.key as Buffer)
      .update(body)
      .digest("base64url");
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
