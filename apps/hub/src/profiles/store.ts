import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { UserProfile } from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { openBlobDir, sweepBlobDir } from "../storage/blob-dir.js";
import { readIndexFile, type IndexState } from "../storage/index-file.js";

export type ProfileAsset = "icon" | "sound";

/** What the browser may upload, and how big the file may get. */
export const ASSET_RULES: Record<ProfileAsset, { types: string[]; maxBytes: number }> = {
  icon: {
    types: ["image/png", "image/jpeg", "image/gif", "image/webp"],
    maxBytes: 512 * 1024,
  },
  sound: {
    types: ["audio/mpeg", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "audio/mp4"],
    maxBytes: 1024 * 1024,
  },
};

interface StoredAsset {
  contentType: string;
  /** Bumped on every upload so browsers re-fetch instead of using a stale cache. */
  rev: number;
  file: string;
}

interface StoredProfile {
  uid: string;
  icon?: StoredAsset;
  sound?: StoredAsset;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "weba",
  "audio/mp4": "m4a",
};

/** TeamSpeak UIDs are base64 and unusable as file names, so key files by their hash. */
function keyOf(uid: string): string {
  return createHash("sha256").update(uid).digest("hex").slice(0, 32);
}

const KNOWN_EXTENSIONS = new Set([...Object.values(EXTENSIONS), "bin"]);

/** `<uid hash>.<asset>.<ext>` and nothing else: `index.json` and strangers fail this. */
function isAssetFile(name: string): boolean {
  const [key, asset, ext, ...rest] = name.split(".");
  if (rest.length > 0 || !key || !ext) return false;
  if (!/^[0-9a-f]{32}$/.test(key)) return false;
  return (asset === "icon" || asset === "sound") && KNOWN_EXTENSIONS.has(ext);
}

/**
 * Per-user avatar icon and channel-entry sound, keyed by TeamSpeak identity UID
 * so they follow the user across sessions and servers this hub serves.
 *
 * The uploads live under `blobs/`, the small JSON index beside it; the index is
 * rewritten on every change, which is plenty for the handful of users a hub
 * carries. Keeping the two apart is what makes `sweep` safe: it may delete any
 * file in the blobs directory the index does not name, and the index is not in
 * there to be deleted. Uploads from an older hub sit in the root instead, and
 * `openBlobDir` moves those down on construction.
 *
 * An index that exists but cannot be read or parsed puts the store into its
 * "unreadable" state, where it neither sweeps nor writes: see `IndexState` for
 * why an empty list would otherwise take every upload with it.
 */
export class ProfileStore {
  private readonly profiles = new Map<string, StoredProfile>();
  private readonly indexFile: string;
  private readonly blobsDir: string;
  private indexState: IndexState = "empty";

  constructor(
    dir: string,
    private readonly log?: Logger,
  ) {
    this.indexFile = path.join(dir, "index.json");
    this.blobsDir = openBlobDir(dir, isAssetFile, log);
    this.load();
  }

  private load(): void {
    const read = readIndexFile(this.indexFile);
    if (read.state === "empty") return; // first run
    if (read.state === "unreadable") {
      this.unusable(read.err, "could not read the profile index; keeping every upload untouched");
      return;
    }
    try {
      const parsed = JSON.parse(read.raw) as StoredProfile[];
      for (const p of parsed) {
        if (p && typeof p.uid === "string") this.profiles.set(p.uid, p);
      }
      this.indexState = "loaded";
    } catch (err) {
      this.profiles.clear();
      this.unusable(err, "profile index is corrupt; keeping every upload untouched");
    }
  }

  /** Serve what we can, delete nothing, write nothing, and say so loudly. */
  private unusable(err: unknown, message: string): void {
    this.indexState = "unreadable";
    this.log?.error({ err, indexFile: this.indexFile }, message);
  }

  private persist(): void {
    if (this.indexState === "unreadable") {
      // Writing now would replace whatever is there with a list built from a
      // load that failed, i.e. throw away every profile the file still holds.
      this.log?.error(
        { indexFile: this.indexFile },
        "not writing over a profile index we could not read",
      );
      return;
    }
    writeFileSync(this.indexFile, JSON.stringify([...this.profiles.values()], null, 2));
  }

  /** Everything the browsers need to know: who has what, and at which revision. */
  list(): UserProfile[] {
    return [...this.profiles.values()].map((p) => this.describe(p));
  }

  get(uid: string): UserProfile {
    const p = this.profiles.get(uid);
    return p ? this.describe(p) : { uid, icon: null, sound: null };
  }

  private describe(p: StoredProfile): UserProfile {
    return {
      uid: p.uid,
      icon: p.icon ? p.icon.rev : null,
      sound: p.sound ? p.sound.rev : null,
    };
  }

  read(uid: string, asset: ProfileAsset): { body: Buffer; contentType: string } | null {
    const stored = this.profiles.get(uid)?.[asset];
    if (!stored) return null;
    try {
      return {
        body: readFileSync(path.join(this.blobsDir, stored.file)),
        contentType: stored.contentType,
      };
    } catch {
      return null;
    }
  }

  save(uid: string, asset: ProfileAsset, body: Buffer, contentType: string): UserProfile {
    const profile = this.profiles.get(uid) ?? { uid };
    const rev = (profile[asset]?.rev ?? 0) + 1;
    const file = `${keyOf(uid)}.${asset}.${EXTENSIONS[contentType] ?? "bin"}`;
    writeFileSync(path.join(this.blobsDir, file), body);
    // The extension follows the content type, so an older file may be orphaned.
    if (profile[asset] && profile[asset].file !== file) this.unlink(profile[asset].file);
    profile[asset] = { contentType, rev, file };
    this.profiles.set(uid, profile);
    this.persist();
    return this.describe(profile);
  }

  remove(uid: string, asset: ProfileAsset): UserProfile {
    const profile = this.profiles.get(uid);
    if (!profile?.[asset]) return this.get(uid);
    this.unlink(profile[asset].file);
    delete profile[asset];
    if (!profile.icon && !profile.sound) this.profiles.delete(uid);
    else this.profiles.set(uid, profile);
    this.persist();
    return this.get(uid);
  }

  private unlink(file: string): void {
    try {
      rmSync(path.join(this.blobsDir, file));
    } catch {
      /* already gone */
    }
  }

  /** Drops blobs no index entry points at (left behind by a crash mid-write). */
  sweep(): void {
    if (this.indexState === "unreadable") {
      // The index names nothing only because nobody could read it, so every
      // upload on disk looks unreferenced. Deleting them all is the bug.
      this.log?.error(
        { indexFile: this.indexFile, dir: this.blobsDir },
        "not sweeping profile uploads: the index could not be read",
      );
      return;
    }
    const kept = new Set<string>();
    for (const p of this.profiles.values()) {
      if (p.icon) kept.add(p.icon.file);
      if (p.sound) kept.add(p.sound.file);
    }
    sweepBlobDir(this.blobsDir, kept, this.log);
  }
}
