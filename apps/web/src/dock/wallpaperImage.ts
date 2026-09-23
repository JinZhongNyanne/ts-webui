/**
 * Where the desktop wallpaper's bytes live: IndexedDB, in this browser only.
 *
 * A picture is far too big for `localStorage`, which already holds the dock
 * layout and would be pushed over quota by one photo, and it is nobody else's
 * business either — so it never goes near the hub, exactly like the custom cue
 * sounds in `notify/customSounds.ts`, whose transaction handling this follows.
 *
 * The chosen *fit* is a tiny string and stays in `localStorage` with the rest
 * of the small preferences; only the bytes are here.
 */

const DB_NAME = "jinz.desktop";
const STORE = "wallpaper";
/** One wallpaper at a time, so one fixed key. */
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb unavailable"));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  body: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = body(tx.objectStore(STORE));
        // Settle on the transaction, not the request: a write can still be
        // aborted (quota) after its request succeeded, and "saved" would lie.
        // Every outcome closes the connection.
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? req.error ?? new Error("indexeddb failed"));
        };
      }),
  );
}

/** Throws when storage is unavailable or full, so the caller can say so. */
export async function saveWallpaperImage(blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(blob, KEY));
}

/** The stored picture, or null — including when storage is blocked entirely. */
export async function loadWallpaperImage(): Promise<Blob | null> {
  try {
    const blob = await run<Blob | undefined>(
      "readonly",
      (s) => s.get(KEY) as IDBRequest<Blob | undefined>,
    );
    return blob instanceof Blob ? blob : null;
  } catch {
    // Private mode / blocked storage: the theme's own background, then.
    return null;
  }
}

export async function deleteWallpaperImage(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY) as unknown as IDBRequest<undefined>);
  } catch {
    /* nothing stored, nothing to remove */
  }
}
