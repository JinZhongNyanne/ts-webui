/**
 * Refcounted set of BotBridges, one per bot URL.
 *
 * Every session names its own bot, but most sessions on one TeamSpeak server
 * share the same one, and the bot only tolerates so many websocket clients.
 * The pool hands out one bridge per normalized URL and stops it when the last
 * session using it lets go.
 */
import { BotBridge, type BotBridgeOptions } from "./BotBridge.js";
import { MAX_POOLED_BRIDGES, MUSIC_UNREACHABLE, normalizeMusicBotUrl } from "./target.js";
import type { Config } from "../config.js";
import type { Logger } from "../logger.js";
import { MusicStateStore } from "./music-state.js";

/** The slice of BotBridge a session and the proxy routes need. */
export type PooledBridge = Pick<
  BotBridge,
  | "available"
  | "unavailableReason"
  | "summaries"
  | "subscribe"
  | "request"
  | "start"
  | "stop"
  | "radioOf"
  | "setRadio"
  | "queueOf"
  | "refreshQueue"
  | "credit"
  | "relabel"
>;

export type BridgeFactory = (opts: BotBridgeOptions) => PooledBridge;

export type BridgePoolConfig = Pick<
  Config,
  "MUSICBOT_URL" | "MUSICBOT_USERNAME" | "MUSICBOT_PASSWORD" | "MUSICBOT_INSECURE_TLS"
>;

export interface BridgePoolOptions {
  config: BridgePoolConfig;
  logger: Logger;
  /** Injectable for tests; defaults to a real BotBridge. */
  factory?: BridgeFactory;
  /** Radios and requesters kept across bridges and restarts; in memory when omitted. */
  state?: MusicStateStore;
}

interface Entry {
  readonly bridge: PooledBridge;
  readonly refs: number;
  /** Settles once the bridge's first login/refresh attempt is over. */
  readonly started: Promise<void>;
}

const defaultFactory: BridgeFactory = (opts) => new BotBridge(opts);

export class BridgePool {
  private readonly entries = new Map<string, Entry>();
  /** Each bot URL's radios and requesters; kept while a bridge comes and goes. */
  private readonly state: MusicStateStore;
  private readonly factory: BridgeFactory;
  private readonly log: Logger;
  private readonly config: BridgePoolConfig;
  /** The operator's bot, normalized so a session naming it gets its credentials. */
  readonly globalUrl: string | null;

  constructor(opts: BridgePoolOptions) {
    this.factory = opts.factory ?? defaultFactory;
    this.state = opts.state ?? new MusicStateStore();
    this.log = opts.logger;
    this.config = opts.config;
    this.globalUrl = opts.config.MUSICBOT_URL
      ? normalizeMusicBotUrl(opts.config.MUSICBOT_URL)
      : null;
  }

  /**
   * Takes a reference on the bridge for `url`, creating and starting it on
   * first use. Resolves once the bridge has finished its first start attempt,
   * so `available` is meaningful. The reference is taken synchronously, so a
   * matching `release()` is owed even if the caller stops waiting.
   */
  acquire(url: string, pinnedAddress: string | null = null): Promise<PooledBridge> {
    const existing = this.entries.get(url);
    if (existing) {
      this.entries.set(url, { ...existing, refs: existing.refs + 1 });
      return existing.started.then(() => existing.bridge);
    }
    if (this.entries.size >= MAX_POOLED_BRIDGES) {
      this.log.warn({ url, pooled: this.entries.size }, "music bridge pool is full");
      return Promise.reject(new Error(MUSIC_UNREACHABLE));
    }
    const bridge = this.factory(this.optionsFor(url, pinnedAddress));
    const started = bridge.start().catch((err: unknown) => {
      this.log.warn({ err, url }, "music bridge start failed");
    });
    this.entries.set(url, { bridge, refs: 1, started });
    this.log.info({ url, pooled: this.entries.size }, "music bridge created");
    return started.then(() => bridge);
  }

  /** Drops one reference; the bridge is stopped when nobody uses it any more. */
  release(url: string): void {
    const entry = this.entries.get(url);
    if (!entry) {
      this.log.warn({ url }, "release of a music bridge that is not pooled");
      return;
    }
    if (entry.refs > 1) {
      this.entries.set(url, { ...entry, refs: entry.refs - 1 });
      return;
    }
    this.entries.delete(url);
    // Nothing to remember: don't keep a map for every URL anyone ever typed.
    this.state.forgetIfEmpty(url);
    this.stopQuietly(entry.bridge, url);
    this.log.info({ url, pooled: this.entries.size }, "music bridge stopped");
  }

  /** Reference count for `url`, for tests and diagnostics. */
  refs(url: string): number {
    return this.entries.get(url)?.refs ?? 0;
  }

  /** Hub shutdown: stop every bridge regardless of who still holds it. */
  stopAll(): void {
    for (const [url, entry] of this.entries) this.stopQuietly(entry.bridge, url);
    this.entries.clear();
    this.state.flush();
  }

  private stopQuietly(bridge: PooledBridge, url: string): void {
    try {
      bridge.stop();
    } catch (err) {
      this.log.warn({ err, url }, "music bridge stop failed");
    }
  }

  /** Guest mode everywhere except on the operator's own bot, which may have an account. */
  private optionsFor(url: string, pinnedAddress: string | null): BotBridgeOptions {
    const isGlobal = this.globalUrl !== null && url === this.globalUrl;
    return {
      state: this.state.forUrl(url),
      onStateChange: () => this.state.changed(),
      baseUrl: url,
      pinnedAddress,
      username: isGlobal ? this.config.MUSICBOT_USERNAME : "",
      password: isGlobal ? this.config.MUSICBOT_PASSWORD : "",
      insecureTls: isGlobal ? this.config.MUSICBOT_INSECURE_TLS : false,
      logger: this.log.child({ bot: url }),
    };
  }
}
