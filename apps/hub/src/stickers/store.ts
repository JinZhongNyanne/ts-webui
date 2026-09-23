import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  MAX_STICKER_PACKS,
  STICKER_EXTENSIONS,
  isStickerHash,
  isStickerImageType,
  maxStickersIn,
  normalizeStickerName,
  type Sticker,
  type StickerImageType,
  type StickerPack,
  type StickerScope,
  type StickerSet,
} from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { openBlobDir, sweepBlobDir } from "../storage/blob-dir.js";
import { readIndexFile, type IndexState } from "../storage/index-file.js";

/** Whose stickers a call is about: the hub's shared set, or one identity's own. */
export type StickerTarget = { scope: "shared" } | { scope: "personal"; uid: string };

export type AddStickerResult = { ok: true; sticker: Sticker } | { ok: false; reason: AddReason };
export type AddPackResult = { ok: true; pack: StickerPack } | { ok: false; reason: AddReason };

/** "full": the scope's cap; "pack": no such pack here; "duplicate": that pack name is taken. */
export type AddReason = "full" | "pack" | "duplicate";

/** What a sticker edit may change; `packId: null` means "ungrouped". */
export interface StickerPatch {
  readonly name?: string;
  readonly packId?: string | null;
}

/** What deleting a pack does with the stickers in it. */
export type PackRemoval = "ungroup" | "delete";

export interface NewSticker {
  /** Already normalized by the caller. */
  readonly name: string;
  readonly packId: string | null;
  readonly body: Buffer;
  /** Already sniffed from `body` by the caller. */
  readonly contentType: StickerImageType;
  readonly addedBy: string;
}

interface ScopeData {
  packs: StickerPack[];
  stickers: Sticker[];
}

/** Ids name nothing on disk, but only our own UUID shape is ever accepted. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const empty = (): ScopeData => ({ packs: [], stickers: [] });

/** The shared set and every personal one live in one map; "" is the shared key. */
function keyOf(target: StickerTarget): string {
  return target.scope === "shared" ? "" : target.uid;
}

function revivePack(item: unknown): StickerPack | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) return null;
  const name = normalizeStickerName(raw.name as string);
  if (!name) return null;
  return { id: raw.id, name, createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0 };
}

/** An entry as read from disk, or null when any part of it is off. */
function reviveSticker(item: unknown, packIds: ReadonlySet<string>): Sticker | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) return null;
  if (!isStickerHash(raw.hash) || !isStickerImageType(raw.contentType)) return null;
  const name = normalizeStickerName(raw.name as string);
  if (!name) return null;
  // A pack that did not survive the reload leaves its stickers ungrouped.
  const packId = typeof raw.packId === "string" && packIds.has(raw.packId) ? raw.packId : null;
  return {
    id: raw.id,
    name,
    packId,
    hash: raw.hash,
    contentType: raw.contentType,
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    addedBy: typeof raw.addedBy === "string" ? raw.addedBy : "",
    addedAt: typeof raw.addedAt === "number" ? raw.addedAt : 0,
  };
}

function reviveScope(item: unknown, scope: StickerScope): ScopeData {
  if (!item || typeof item !== "object") return empty();
  const raw = item as Record<string, unknown>;
  const packs: StickerPack[] = [];
  const seenPacks = new Set<string>();
  for (const p of Array.isArray(raw.packs) ? raw.packs : []) {
    const pack = revivePack(p);
    if (!pack || seenPacks.has(pack.id) || packs.length >= MAX_STICKER_PACKS) continue;
    seenPacks.add(pack.id);
    packs.push(pack);
  }
  const stickers: Sticker[] = [];
  const seen = new Set<string>();
  const cap = maxStickersIn(scope);
  for (const s of Array.isArray(raw.stickers) ? raw.stickers : []) {
    const sticker = reviveSticker(s, seenPacks);
    if (!sticker || seen.has(sticker.id) || stickers.length >= cap) continue;
    seen.add(sticker.id);
    stickers.push(sticker);
  }
  return { packs, stickers };
}

/**
 * Stickers on the hub: one shared set plus one per TeamSpeak identity, each
 * with its own packs, and one content-addressed pile of pictures underneath.
 *
 * A picture is written once, as `blobs/<sha256>.<ext>`, however many entries
 * point at it; the reference count is simply how many entries name that hash,
 * so it can never drift from the index. Deleting the last one deletes the
 * file. An index entry is the small part, and the whole index is rewritten
 * (write-then-rename) on every change, which is plenty for the few hundred
 * entries the caps allow.
 *
 * `openBlobDir` makes that directory, the same one every version of this store
 * has used, so there is no older layout to migrate away from and no predicate
 * to give it. An index that exists but cannot be read or parsed puts the store
 * into its "unreadable" state, where it neither sweeps nor writes: see
 * `IndexState` for why an empty index would otherwise take every picture.
 */
export class StickerStore {
  private scopes = new Map<string, ScopeData>();
  private readonly indexFile: string;
  private readonly blobsDir: string;
  private indexState: IndexState = "empty";

  constructor(
    dir: string,
    private readonly log?: Logger,
  ) {
    this.indexFile = path.join(dir, "index.json");
    this.blobsDir = openBlobDir(dir, null, log);
    this.load();
  }

  private load(): void {
    const read = readIndexFile(this.indexFile);
    if (read.state === "empty") return; // first run
    if (read.state === "unreadable") {
      this.unusable(read.err, "could not read the sticker index; keeping every picture untouched");
      return;
    }
    try {
      const parsed = JSON.parse(read.raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object") throw new Error("not an object");
      this.scopes.set("", reviveScope(parsed.shared, "shared"));
      const personal = parsed.personal;
      if (personal && typeof personal === "object") {
        for (const [uid, data] of Object.entries(personal as Record<string, unknown>)) {
          if (uid) this.scopes.set(uid, reviveScope(data, "personal"));
        }
      }
      this.indexState = "loaded";
    } catch (err) {
      this.scopes.clear();
      this.unusable(err, "sticker index is corrupt; keeping every picture untouched");
    }
  }

  /** Serve what we can, delete nothing, write nothing, and say so loudly. */
  private unusable(err: unknown, message: string): void {
    this.indexState = "unreadable";
    this.log?.error({ err, indexFile: this.indexFile }, message);
  }

  private persist(): void {
    if (this.indexState === "unreadable") {
      // Writing now would replace whatever is there with an index built from a
      // load that failed, i.e. throw away every sticker the file still holds.
      this.log?.error(
        { indexFile: this.indexFile },
        "not writing over a sticker index we could not read",
      );
      return;
    }
    const personal: Record<string, ScopeData> = {};
    for (const [key, data] of this.scopes) {
      if (key) personal[key] = data;
    }
    // Write-then-rename, so a crash mid-write leaves the old index, not half a file.
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ shared: this.scopes.get("") ?? empty(), personal }, null, 2),
    );
    renameSync(tmp, this.indexFile);
  }

  private dataOf(target: StickerTarget): ScopeData {
    return this.scopes.get(keyOf(target)) ?? empty();
  }

  private put(target: StickerTarget, next: ScopeData): void {
    const key = keyOf(target);
    // An emptied personal set leaves nothing behind; the shared one always exists.
    if (key && next.packs.length === 0 && next.stickers.length === 0) this.scopes.delete(key);
    else this.scopes.set(key, next);
    this.persist();
  }

  list(target: StickerTarget): StickerSet {
    const data = this.dataOf(target);
    return { scope: target.scope, packs: [...data.packs], stickers: [...data.stickers] };
  }

  /* ---------------------------------------------------------------- packs */

  addPack(target: StickerTarget, name: string, now = Date.now()): AddPackResult {
    const data = this.dataOf(target);
    if (data.packs.length >= MAX_STICKER_PACKS) return { ok: false, reason: "full" };
    if (this.hasPackNamed(data, name, null)) return { ok: false, reason: "duplicate" };
    const pack: StickerPack = { id: randomUUID(), name, createdAt: now };
    this.put(target, { ...data, packs: [...data.packs, pack] });
    return { ok: true, pack };
  }

  private hasPackNamed(data: ScopeData, name: string, exceptId: string | null): boolean {
    const lower = name.toLowerCase();
    return data.packs.some((p) => p.id !== exceptId && p.name.toLowerCase() === lower);
  }

  /** The renamed pack, or null when there is none here; "duplicate" when the name is taken. */
  renamePack(target: StickerTarget, id: string, name: string): StickerPack | "duplicate" | null {
    const data = this.dataOf(target);
    const current = data.packs.find((p) => p.id === id);
    if (!current) return null;
    if (this.hasPackNamed(data, name, id)) return "duplicate";
    const next: StickerPack = { ...current, name };
    this.put(target, { ...data, packs: data.packs.map((p) => (p.id === id ? next : p)) });
    return next;
  }

  /** Deletes a pack, either ungrouping its stickers or deleting them with it. */
  removePack(target: StickerTarget, id: string, stickers: PackRemoval): boolean {
    const data = this.dataOf(target);
    if (!data.packs.some((p) => p.id === id)) return false;
    const inPack = data.stickers.filter((s) => s.packId === id);
    const next: ScopeData = {
      packs: data.packs.filter((p) => p.id !== id),
      stickers:
        stickers === "delete"
          ? data.stickers.filter((s) => s.packId !== id)
          : data.stickers.map((s) => (s.packId === id ? { ...s, packId: null } : s)),
    };
    this.put(target, next);
    if (stickers === "delete") this.collect(inPack);
    return true;
  }

  /* ------------------------------------------------------------- stickers */

  /** `name` must be normalized and `body` sniffed as `contentType` by the caller. */
  addSticker(target: StickerTarget, item: NewSticker, now = Date.now()): AddStickerResult {
    const data = this.dataOf(target);
    if (data.stickers.length >= maxStickersIn(target.scope)) return { ok: false, reason: "full" };
    if (item.packId !== null && !data.packs.some((p) => p.id === item.packId)) {
      return { ok: false, reason: "pack" };
    }
    const hash = createHash("sha256").update(item.body).digest("hex");
    // A picture already on the hub costs nothing but the entry pointing at it.
    if (!this.blobExists(hash, item.contentType)) {
      writeFileSync(this.blobPath(hash, item.contentType), item.body);
    }
    const sticker: Sticker = {
      id: randomUUID(),
      name: item.name,
      packId: item.packId,
      hash,
      contentType: item.contentType,
      bytes: item.body.length,
      addedBy: item.addedBy,
      addedAt: now,
    };
    this.put(target, { ...data, stickers: [...data.stickers, sticker] });
    return { ok: true, sticker };
  }

  /** Applies an edit; null when there is no such sticker, "pack" for an unknown pack. */
  updateSticker(target: StickerTarget, id: string, patch: StickerPatch): Sticker | "pack" | null {
    const data = this.dataOf(target);
    const current = data.stickers.find((s) => s.id === id);
    if (!current) return null;
    if (
      patch.packId !== undefined &&
      patch.packId !== null &&
      !data.packs.some((p) => p.id === patch.packId)
    ) {
      return "pack";
    }
    const next: Sticker = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.packId !== undefined ? { packId: patch.packId } : {}),
    };
    this.put(target, { ...data, stickers: data.stickers.map((s) => (s.id === id ? next : s)) });
    return next;
  }

  removeSticker(target: StickerTarget, id: string): boolean {
    const data = this.dataOf(target);
    const sticker = data.stickers.find((s) => s.id === id);
    if (!sticker) return false;
    this.put(target, { ...data, stickers: data.stickers.filter((s) => s.id !== id) });
    this.collect([sticker]);
    return true;
  }

  /* ---------------------------------------------------------------- blobs */

  private blobPath(hash: string, contentType: StickerImageType): string {
    return path.join(this.blobsDir, `${hash}.${STICKER_EXTENSIONS[contentType]}`);
  }

  private blobExists(hash: string, contentType: StickerImageType): boolean {
    try {
      readFileSync(this.blobPath(hash, contentType));
      return true;
    } catch {
      return false;
    }
  }

  /** How many entries, in any scope, point at `hash`. */
  references(hash: string): number {
    let n = 0;
    for (const data of this.scopes.values()) {
      for (const s of data.stickers) if (s.hash === hash) n++;
    }
    return n;
  }

  /** Drops the file of every picture `gone` held the last reference to. */
  private collect(gone: readonly Sticker[]): void {
    for (const sticker of gone) {
      if (this.references(sticker.hash) > 0) continue;
      try {
        rmSync(this.blobPath(sticker.hash, sticker.contentType), { force: true });
      } catch (err) {
        this.log?.warn({ err, hash: sticker.hash }, "could not delete a sticker file");
      }
    }
  }

  /**
   * A stored picture, by hash. Only a hash some entry points at is served, so
   * an unreferenced file left behind by a crash is not a public blob store.
   */
  read(hash: string): { body: Buffer; contentType: StickerImageType } | null {
    if (!isStickerHash(hash)) return null;
    for (const data of this.scopes.values()) {
      const sticker = data.stickers.find((s) => s.hash === hash);
      if (!sticker) continue;
      try {
        return {
          body: readFileSync(this.blobPath(hash, sticker.contentType)),
          contentType: sticker.contentType,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  /** Drops blob files no entry points at (left behind by a crash mid-write). */
  sweep(): void {
    if (this.indexState === "unreadable") {
      // The index names nothing only because nobody could read it, so every
      // picture on disk looks unreferenced. Deleting them all is the bug.
      this.log?.error(
        { indexFile: this.indexFile, dir: this.blobsDir },
        "not sweeping sticker pictures: the index could not be read",
      );
      return;
    }
    const kept = new Set<string>();
    for (const data of this.scopes.values()) {
      for (const s of data.stickers) kept.add(`${s.hash}.${STICKER_EXTENSIONS[s.contentType]}`);
    }
    sweepBlobDir(this.blobsDir, kept, this.log);
  }
}
