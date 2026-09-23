/**
 * IndexedDB storage for the chat history (`history.ts` holds the rules).
 *
 * One object store of messages with two indexes: (server, conversation, at)
 * for reading and trimming a conversation in order, and `at` for the global
 * retention sweep.
 */
import type { HistoryBackend, StoredMessage } from "./history";

const DB_NAME = "jinz-chat-history";
const DB_VERSION = 1;
const STORE = "messages";
const BY_CONVERSATION = "byConversation";
const BY_AT = "byAt";

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function conversationRange(server: string, conversation: string): IDBKeyRange {
  return IDBKeyRange.bound([server, conversation, -Infinity], [server, conversation, Infinity]);
}

/** Walks a cursor, deleting up to `limit` rows. */
function deleteWith(req: IDBRequest<IDBCursorWithValue | null>, limit = Infinity): void {
  let left = limit;
  req.onsuccess = () => {
    const cursor = req.result;
    if (!cursor || left <= 0) return;
    cursor.delete();
    left--;
    cursor.continue();
  };
}

export class IdbHistoryBackend implements HistoryBackend {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex(BY_CONVERSATION, ["server", "conversation", "at"]);
        store.createIndex(BY_AT, "at");
      };
      req.onsuccess = () => {
        const db = req.result;
        // A newer page in another tab wants to upgrade: step aside (and reopen
        // on next use) instead of blocking it.
        db.onversionchange = () => {
          db.close();
          this.db = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
      // Another tab holding an older version: better to fail than to hang.
      req.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
    });
    // A failed open is not cached, so the next call can try again.
    this.db.catch(() => (this.db = null));
    return this.db;
  }

  private async tx(
    mode: IDBTransactionMode,
  ): Promise<{ tx: IDBTransaction; store: IDBObjectStore }> {
    const db = await this.open();
    const tx = db.transaction(STORE, mode);
    return { tx, store: tx.objectStore(STORE) };
  }

  async add(msg: StoredMessage): Promise<number> {
    const { tx, store } = await this.tx("readwrite");
    const id = promisify(store.add(msg));
    await done(tx);
    return Number(await id);
  }

  async list(server: string, conversation: string): Promise<StoredMessage[]> {
    const { store } = await this.tx("readonly");
    const rows = await promisify(
      store.index(BY_CONVERSATION).getAll(conversationRange(server, conversation)),
    );
    return rows as StoredMessage[];
  }

  async count(server: string, conversation: string): Promise<number> {
    const { store } = await this.tx("readonly");
    return promisify(store.index(BY_CONVERSATION).count(conversationRange(server, conversation)));
  }

  async deleteOldest(server: string, conversation: string, n: number): Promise<void> {
    const { tx, store } = await this.tx("readwrite");
    deleteWith(store.index(BY_CONVERSATION).openCursor(conversationRange(server, conversation)), n);
    await done(tx);
  }

  async deleteConversation(server: string, conversation: string): Promise<void> {
    const { tx, store } = await this.tx("readwrite");
    deleteWith(store.index(BY_CONVERSATION).openCursor(conversationRange(server, conversation)));
    await done(tx);
  }

  async deleteAll(): Promise<void> {
    const { tx, store } = await this.tx("readwrite");
    store.clear();
    await done(tx);
  }

  async deleteBefore(at: number): Promise<void> {
    const { tx, store } = await this.tx("readwrite");
    deleteWith(store.index(BY_AT).openCursor(IDBKeyRange.upperBound(at, true)));
    await done(tx);
  }
}
