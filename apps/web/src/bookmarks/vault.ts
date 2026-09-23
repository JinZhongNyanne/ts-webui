/**
 * Encrypts the passwords saved in bookmarks (server password, default-channel
 * password) before they reach localStorage.
 *
 * Threat model, so nobody over-trusts it:
 * - The AES-GCM key is a *non-extractable* CryptoKey kept in IndexedDB. A copy
 *   of localStorage alone (a synced profile, a backup, a "dump storage"
 *   extension, someone reading DevTools over your shoulder) yields only
 *   ciphertext, and the key's bytes cannot be read out even by page script.
 * - It does NOT protect against script running on this page (XSS, a malicious
 *   extension with page access): such code can simply ask the key to decrypt.
 *   Nor against someone with the unlocked browser profile, who has both stores.
 * - Clearing site data or IndexedDB alone loses the key; the bookmarks survive
 *   but their passwords can no longer be opened and must be typed again.
 */

export interface Sealed {
  /** base64 96-bit nonce. */
  iv: string;
  /** base64 ciphertext + tag. */
  data: string;
}

export interface KeySource {
  get(): Promise<CryptoKey>;
}

export interface Vault {
  seal(plain: string): Promise<Sealed>;
  open(sealed: Sealed): Promise<string>;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function isSealed(v: unknown): v is Sealed {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as Sealed).iv === "string" &&
    typeof (v as Sealed).data === "string"
  );
}

export function createVault(keys: KeySource): Vault {
  return {
    async seal(plain) {
      const key = await keys.get();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(plain),
      );
      return { iv: toB64(iv), data: toB64(new Uint8Array(ct)) };
    },
    async open(sealed) {
      const key = await keys.get();
      const pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(sealed.iv) },
        key,
        fromB64(sealed.data),
      );
      return new TextDecoder().decode(pt);
    },
  };
}

export function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const DB_NAME = "jinz-vault";
const STORE = "keys";
const KEY_ID = "bookmarks";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

async function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

/**
 * The key lives in IndexedDB because only structured clone can persist a
 * non-extractable CryptoKey; created on first use and cached for the page.
 */
export function indexedDbKeySource(): KeySource {
  let pending: Promise<CryptoKey> | null = null;
  const load = async (): Promise<CryptoKey> => {
    const db = await openDb();
    try {
      const existing = await request(db.transaction(STORE).objectStore(STORE).get(KEY_ID));
      if (existing instanceof CryptoKey) return existing;
      const key = await generateVaultKey();
      // `add`, not `put`: two tabs on first use would each write a key and the
      // loser would seal passwords nobody can open after a reload. The second
      // `add` fails, and that tab takes the key that won.
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add(key, KEY_ID);
      try {
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write failed"));
        });
        return key;
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "ConstraintError")) throw err;
        const winner = await request(db.transaction(STORE).objectStore(STORE).get(KEY_ID));
        if (winner instanceof CryptoKey) return winner;
        throw err;
      }
    } finally {
      db.close();
    }
  };
  return {
    get() {
      // Retry after a failure (e.g. a private window that later allows IDB).
      pending ??= load().catch((err: unknown) => {
        pending = null;
        throw err;
      });
      return pending;
    },
  };
}
