/**
 * Local storage for a profile asset the user picked before connecting.
 *
 * The hub keys profiles by TeamSpeak UID and only accepts a write from a live
 * session, so a file chosen while offline is parked here (IndexedDB — these are
 * up to 1 MB blobs) and uploaded as soon as a session exists.
 */
export type ProfileAsset = "icon" | "sound";

export interface ProfileDraft {
  asset: ProfileAsset;
  blob: Blob;
  type: string;
  name: string;
}

const DB_NAME = "jinz.profile";
const STORE = "drafts";

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
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexeddb failed"));
        tx.oncomplete = () => db.close();
      }),
  );
}

export async function saveDraft(draft: ProfileDraft): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(draft, draft.asset));
  } catch {
    /* private mode / blocked storage: the draft just won't survive a reload */
  }
}

export async function loadDrafts(): Promise<ProfileDraft[]> {
  try {
    const all = await run<ProfileDraft[]>(
      "readonly",
      (s) => s.getAll() as IDBRequest<ProfileDraft[]>,
    );
    return all.filter((d) => d?.blob instanceof Blob);
  } catch {
    return [];
  }
}

export async function clearDraft(asset: ProfileAsset): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(asset) as unknown as IDBRequest<undefined>);
  } catch {
    /* nothing to clean up */
  }
}
