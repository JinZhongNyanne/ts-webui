/**
 * User-supplied replacement sounds, one per cue event, kept in IndexedDB so
 * they survive a reload without going anywhere near the hub. They are local
 * to this browser on purpose: a sound pack is a personal preference, not
 * something the other people on the server should have to download.
 */
import { isCueEvent, type CueEvent } from "./events";

/** Cues are short; anything bigger is almost certainly a whole song. */
export const CUSTOM_SOUND_MAX_BYTES = 512 * 1024;

export type CustomSoundError = "too-large" | "bad-type";

export interface CustomSound {
  event: CueEvent;
  blob: Blob;
  name: string;
}

/**
 * The browser decodes whatever it can, so the check is only "claims to be
 * audio" (an empty type is let through — some systems don't label .ogg) plus
 * the size cap. A file that is not really audio fails at decode time instead.
 */
export function validateCustomSound(file: { size: number; type: string }): CustomSoundError | null {
  if (file.size > CUSTOM_SOUND_MAX_BYTES) return "too-large";
  if (file.type && !file.type.startsWith("audio/")) return "bad-type";
  return null;
}

const DB_NAME = "jinz.cues";
const STORE = "sounds";

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

/** Throws when storage is unavailable, so the settings UI can say so. */
export async function saveCustomSound(sound: CustomSound): Promise<void> {
  await run("readwrite", (s) => s.put(sound, sound.event));
}

export async function loadCustomSounds(): Promise<CustomSound[]> {
  try {
    const all = await run<CustomSound[]>(
      "readonly",
      (s) => s.getAll() as IDBRequest<CustomSound[]>,
    );
    return all.filter((d) => isCueEvent(d?.event) && d.blob instanceof Blob);
  } catch {
    // Private mode / blocked storage: built-in sounds only.
    return [];
  }
}

export async function deleteCustomSound(event: CueEvent): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(event) as unknown as IDBRequest<undefined>);
  } catch {
    /* nothing stored, nothing to remove */
  }
}
