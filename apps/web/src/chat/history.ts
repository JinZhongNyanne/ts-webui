/**
 * Local chat history: messages kept in the browser so a reload (or tomorrow's
 * session) still shows what was said.
 *
 * The storage sits behind `HistoryBackend` so the rules here — per-conversation
 * cap, retention, which key a message is filed under — are tested against the
 * in-memory backend; the IndexedDB one (`history-idb.ts`) only moves records.
 *
 * ## Keys
 *
 * **Server.** TeamSpeak does not tell a client the virtual server's unique id
 * (`virtualserver_unique_identifier` is ServerQuery-only; neither `initserver`
 * nor `servergetvariables` carry it). What a client does get and what does not
 * change for the life of a virtual server is `virtualserver_created`, so the
 * key is "where we dialled" + "#" + creation time:
 *
 * - `host:port#created` normally (host lower-cased). Dialling the same server
 *   by another name (IP instead of DNS) starts a separate history; merging on
 *   `created` alone could mix two servers that a host provisioned in the same
 *   second.
 * - `fixed#created` when the hub dials its own fixed server: the page never
 *   learns that address, and there is only one server to tell apart anyway.
 * - The server name stands in for `created` if a server reports 0.
 *
 * **Conversation.** `server` and `channel:<cid>` as in the store (channel ids
 * are stable on a server). Private chats use `uid:<uid>` of the other party,
 * because the store's `client:<clid>` changes on every reconnect and gets
 * reused by whoever connects next.
 */

export interface StoredMessage {
  /** Assigned by the backend. */
  id?: number;
  server: string;
  conversation: string;
  /** Epoch milliseconds. */
  at: number;
  fromName: string;
  fromUid: string;
  text: string;
  self: boolean;
}

/** Just the storage. Everything is per (server, conversation) or global. */
export interface HistoryBackend {
  add(msg: StoredMessage): Promise<number>;
  /** Oldest first. */
  list(server: string, conversation: string): Promise<StoredMessage[]>;
  count(server: string, conversation: string): Promise<number>;
  deleteOldest(server: string, conversation: string, n: number): Promise<void>;
  deleteConversation(server: string, conversation: string): Promise<void>;
  deleteAll(): Promise<void>;
  /** Removes everything older than `at` (epoch ms). */
  deleteBefore(at: number): Promise<void>;
}

export const DEFAULT_CAP = 2000;
export const DAY_MS = 86_400_000;

export interface ChatHistoryOptions {
  /** Messages kept per conversation; the oldest go first. */
  cap?: number;
  now?: () => number;
}

export class ChatHistory {
  private readonly cap: number;
  private readonly now: () => number;

  constructor(
    private readonly backend: HistoryBackend,
    opts: ChatHistoryOptions = {},
  ) {
    this.cap = opts.cap ?? DEFAULT_CAP;
    this.now = opts.now ?? Date.now;
  }

  /** Stores a message and trims its conversation back to the cap. Returns the record id. */
  async append(msg: StoredMessage): Promise<number> {
    const { id: _ignored, ...record } = msg;
    const id = await this.backend.add(record);
    const n = await this.backend.count(msg.server, msg.conversation);
    if (n > this.cap) await this.backend.deleteOldest(msg.server, msg.conversation, n - this.cap);
    return id;
  }

  /** A conversation's stored messages within the retention window, oldest first. */
  async load(
    server: string,
    conversation: string,
    retentionDays: number,
  ): Promise<StoredMessage[]> {
    const since = this.cutoff(retentionDays);
    const all = await this.backend.list(server, conversation);
    return all.filter((m) => m.at >= since);
  }

  /** Drops everything older than the retention window, on every server. */
  async prune(retentionDays: number): Promise<void> {
    if (retentionDays <= 0) return;
    await this.backend.deleteBefore(this.cutoff(retentionDays));
  }

  clearConversation(server: string, conversation: string): Promise<void> {
    return this.backend.deleteConversation(server, conversation);
  }

  clearAll(): Promise<void> {
    return this.backend.deleteAll();
  }

  /** Retention 0 (or less) means "keep until the cap pushes it out". */
  private cutoff(retentionDays: number): number {
    return retentionDays > 0 ? this.now() - retentionDays * DAY_MS : -Infinity;
  }
}

/* ---------------------------------- keys ---------------------------------- */

export interface ServerIdentity {
  /** `virtualserver_created`, unix seconds; 0 when the server did not say. */
  created: number;
  name: string;
}

export interface DialTarget {
  host: string;
  port: number;
  /** The hub dials its own server; `host`/`port` mean nothing then. */
  fixed: boolean;
}

export function historyServerKey(server: ServerIdentity, target: DialTarget): string {
  const where = target.fixed ? "fixed" : `${target.host.trim().toLowerCase()}:${target.port}`;
  const which = server.created > 0 ? String(server.created) : `name:${server.name}`;
  return `${where}#${which}`;
}

/**
 * The history key for one of the store's conversation keys, or null when it
 * cannot be filed yet (a private chat whose partner's UID is unknown).
 */
export function historyConversation(
  liveKey: string,
  uidOfClient: (clid: number) => string | undefined,
): string | null {
  if (liveKey === "server" || /^channel:\d+$/.test(liveKey)) return liveKey;
  const m = /^client:(\d+)$/.exec(liveKey);
  if (!m) return null;
  const uid = uidOfClient(Number(m[1]));
  return uid ? `uid:${uid}` : null;
}

/* --------------------------------- search --------------------------------- */

/** Case-insensitive match on the text or the sender; every word must match. */
export function matchesQuery(msg: { text: string; fromName: string }, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${msg.fromName}\n${msg.text}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/* ------------------------------ memory backend ----------------------------- */

/** For tests, and the fallback where IndexedDB is unavailable (history then lasts a page). */
export class MemoryHistoryBackend implements HistoryBackend {
  private rows: StoredMessage[] = [];
  private nextId = 1;

  add(msg: StoredMessage): Promise<number> {
    const id = this.nextId++;
    this.rows = [...this.rows, { ...msg, id }];
    return Promise.resolve(id);
  }

  list(server: string, conversation: string): Promise<StoredMessage[]> {
    return Promise.resolve(
      this.rows
        .filter((m) => m.server === server && m.conversation === conversation)
        .sort((a, b) => a.at - b.at || a.id! - b.id!),
    );
  }

  count(server: string, conversation: string): Promise<number> {
    return this.list(server, conversation).then((l) => l.length);
  }

  async deleteOldest(server: string, conversation: string, n: number): Promise<void> {
    const doomed = new Set((await this.list(server, conversation)).slice(0, n).map((m) => m.id));
    this.rows = this.rows.filter((m) => !doomed.has(m.id));
  }

  deleteConversation(server: string, conversation: string): Promise<void> {
    this.rows = this.rows.filter((m) => !(m.server === server && m.conversation === conversation));
    return Promise.resolve();
  }

  deleteAll(): Promise<void> {
    this.rows = [];
    return Promise.resolve();
  }

  deleteBefore(at: number): Promise<void> {
    this.rows = this.rows.filter((m) => m.at >= at);
    return Promise.resolve();
  }
}
