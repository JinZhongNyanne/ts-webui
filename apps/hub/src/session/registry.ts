import type { AssetTokenGrant } from "@jinz/protocol";
import { AssetTokenStore } from "./asset-token.js";
import type { Session } from "./Session.js";

/**
 * Something a session held has ended: one of its TeamSpeak connections
 * (`connection`, the TsSession, compared by identity), or the whole session
 * (`connection` null), which ends its connection too.
 */
export interface SessionEnd {
  readonly sessionId: string;
  readonly connection: object | null;
}

export type SessionEndListener = (end: SessionEnd) => void;

/** How a listener's error is reported when the owner gives no logger. */
const warnListenerError = (err: unknown): void =>
  process.emitWarning(`session end listener failed: ${String(err)}`);

/**
 * Live browser sessions, keyed by session id. HTTP routes (music proxy,
 * LiveKit tokens) use it to require that the caller is a connected TS user.
 * Asset routes go through short-lived tokens instead of the session id.
 *
 * It also tells whoever holds something on a session's behalf the moment that
 * session or its TeamSpeak connection ends (onEnd). A media stream runs on a
 * connection of its own, and checking the session only on the next request
 * (or a periodic sweep) let a kicked, banned or disconnected user go on
 * receiving a channel file's bytes for seconds after they lost access.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, Session>();
  private listeners: ReadonlySet<SessionEndListener> = new Set();

  constructor(
    private readonly assetTokens: AssetTokenStore = new AssetTokenStore(),
    private readonly reportListenerError: (err: unknown) => void = warnListenerError,
  ) {}

  add(session: Session): void {
    this.sessions.set(session.id, session);
  }

  remove(id: string): void {
    this.sessions.delete(id);
    this.assetTokens.revokeSession(id);
    this.emitEnd({ sessionId: id, connection: null });
  }

  /** Called by a session whenever it lets go of a TeamSpeak connection, for whatever reason. */
  connectionClosed(sessionId: string, connection: object): void {
    this.emitEnd({ sessionId, connection });
  }

  /** Hears every SessionEnd from now on; the answer unsubscribes. */
  onEnd(listener: SessionEndListener): () => void {
    this.listeners = new Set([...this.listeners, listener]);
    return () => {
      this.listeners = new Set([...this.listeners].filter((l) => l !== listener));
    };
  }

  /**
   * Tells every listener. One that throws is reported and the rest still
   * hear it: this runs inside a session's teardown, which must finish.
   */
  private emitEnd(end: SessionEnd): void {
    for (const listener of this.listeners) {
      try {
        listener(end);
      } catch (err) {
        this.reportListenerError(err);
      }
    }
  }

  get(id: string | undefined): Session | undefined {
    return id ? this.sessions.get(id) : undefined;
  }

  /** Returns the session only when it is currently connected to a TeamSpeak server. */
  getConnected(id: string | undefined): Session | undefined {
    const s = this.get(id);
    return s && s.tsSession && s.tsSession.selfClientId > 0 ? s : undefined;
  }

  /** Issues a fresh asset token for the session; older ones stay valid until they expire. */
  mintAssetToken(sessionId: string): AssetTokenGrant {
    return this.assetTokens.mint(sessionId);
  }

  /** Same rule as `getConnected`, but the caller presents an asset token instead of the id. */
  getConnectedByAssetToken(token: string | undefined): Session | undefined {
    return this.getConnected(this.assetTokens.resolve(token));
  }

  get size(): number {
    return this.sessions.size;
  }

  values(): IterableIterator<Session> {
    return this.sessions.values();
  }
}
