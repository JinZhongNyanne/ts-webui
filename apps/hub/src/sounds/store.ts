import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEFAULT_SOUND_VOLUME,
  MAX_SOUNDS,
  SOUND_EXTENSIONS,
  clampSoundVolume,
  normalizeSoundName,
  type SharedSound,
  type SoundType,
} from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { openBlobDir } from "../storage/blob-dir.js";
import { readIndexFile, type IndexState } from "../storage/index-file.js";

export type AddSoundResult = { ok: true; sound: SharedSound } | { ok: false; reason: "full" };

/** What an edit may change; both already validated by the caller. */
export interface SoundPatch {
  readonly name?: string;
  readonly volume?: number;
}

/** Ids name files on disk, so only our own UUID shape is ever accepted. */
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function isSoundType(value: unknown): value is SoundType {
  return typeof value === "string" && Object.hasOwn(SOUND_EXTENSIONS, value);
}

function fileOf(sound: SharedSound): string {
  return `${sound.id}.${SOUND_EXTENSIONS[sound.contentType]}`;
}

const AUDIO_EXTENSIONS = new Set(Object.values(SOUND_EXTENSIONS));

/** A clip file and nothing else: `sounds.json`, its `.tmp` and strangers fail this. */
function isSoundFile(name: string): boolean {
  const cut = name.lastIndexOf(".");
  if (cut < 0) return false;
  return ID_PATTERN.test(name.slice(0, cut)) && AUDIO_EXTENSIONS.has(name.slice(cut + 1));
}

/** An index entry as read from disk, or null when any part of it is off. */
function revive(item: unknown): SharedSound | null {
  if (!item || typeof item !== "object") return null;
  const raw = item as Record<string, unknown>;
  if (typeof raw.id !== "string" || !ID_PATTERN.test(raw.id)) return null;
  if (!isSoundType(raw.contentType)) return null;
  const name = normalizeSoundName(raw.name as string);
  if (!name) return null;
  const volume = typeof raw.volume === "number" ? raw.volume : DEFAULT_SOUND_VOLUME;
  return {
    id: raw.id,
    name,
    volume: clampSoundVolume(volume),
    contentType: raw.contentType,
    bytes: typeof raw.bytes === "number" ? raw.bytes : 0,
    addedBy: typeof raw.addedBy === "string" ? raw.addedBy : "",
    addedAt: typeof raw.addedAt === "number" ? raw.addedAt : 0,
  };
}

/**
 * The soundboard, shared by everyone on this hub, in upload order. A JSON
 * index, `sounds.json`, plus one audio file per clip under `blobs/`, named by
 * the clip's server-made id. The index is rewritten on every change, which is
 * plenty for a list capped at MAX_SOUNDS.
 *
 * Clips uploaded to an older hub sit beside the index instead; `openBlobDir`
 * moves those down on construction, before anything reads one.
 *
 * An index that exists but cannot be read or parsed puts the store into its
 * "unreadable" state, where it refuses to write: see `IndexState` for why the
 * next write would otherwise replace the whole soundboard with one clip.
 */
export class SoundStore {
  private sounds: SharedSound[] = [];
  private readonly indexFile: string;
  private readonly blobsDir: string;
  private indexState: IndexState = "empty";

  constructor(
    dir: string,
    private readonly log?: Logger,
  ) {
    this.indexFile = path.join(dir, "sounds.json");
    this.blobsDir = openBlobDir(dir, isSoundFile, log);
    this.load();
  }

  private load(): void {
    const read = readIndexFile(this.indexFile);
    if (read.state === "empty") return; // first run
    if (read.state === "unreadable") {
      this.unusable(read.err, "could not read the sounds index; keeping the file as it is");
      return;
    }
    try {
      const parsed = JSON.parse(read.raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not a list");
      const seen = new Set<string>();
      for (const item of parsed) {
        const sound = revive(item);
        if (!sound || seen.has(sound.id)) continue;
        seen.add(sound.id);
        this.sounds.push(sound);
      }
      this.sounds = this.sounds.slice(0, MAX_SOUNDS);
      this.indexState = "loaded";
    } catch (err) {
      this.sounds = [];
      this.unusable(err, "sounds index is corrupt; keeping the file as it is");
    }
  }

  /** Serve what we can, write nothing, and say so loudly. */
  private unusable(err: unknown, message: string): void {
    this.indexState = "unreadable";
    this.log?.error({ err, indexFile: this.indexFile }, message);
  }

  private persist(): void {
    if (this.indexState === "unreadable") {
      // Writing now would replace whatever is there with a list built from a
      // load that failed, i.e. throw away every clip the file still holds.
      this.log?.error(
        { indexFile: this.indexFile },
        "not writing over a sounds index we could not read",
      );
      return;
    }
    // Write-then-rename, so a crash mid-write leaves the old list, not half a file.
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.sounds, null, 2));
    renameSync(tmp, this.indexFile);
  }

  /** Where a clip's audio lives. */
  private fileOf(sound: SharedSound): string {
    return path.join(this.blobsDir, fileOf(sound));
  }

  list(): SharedSound[] {
    return [...this.sounds];
  }

  /** `name` must be normalized and `body` sniffed as `contentType` by the caller. */
  add(
    name: string,
    body: Buffer,
    contentType: SoundType,
    addedBy: string,
    now = Date.now(),
  ): AddSoundResult {
    if (this.sounds.length >= MAX_SOUNDS) return { ok: false, reason: "full" };
    const sound: SharedSound = {
      id: randomUUID(),
      name,
      volume: DEFAULT_SOUND_VOLUME,
      contentType,
      bytes: body.length,
      addedBy,
      addedAt: now,
    };
    writeFileSync(this.fileOf(sound), body);
    this.sounds = [...this.sounds, sound];
    this.persist();
    return { ok: true, sound };
  }

  /** Applies an edit; null when there is no such clip. */
  update(id: string, patch: SoundPatch): SharedSound | null {
    const current = this.sounds.find((s) => s.id === id);
    if (!current) return null;
    const next: SharedSound = {
      ...current,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.volume !== undefined ? { volume: patch.volume } : {}),
    };
    this.sounds = this.sounds.map((s) => (s.id === id ? next : s));
    this.persist();
    return next;
  }

  remove(id: string): boolean {
    const sound = this.sounds.find((s) => s.id === id);
    if (!sound) return false;
    this.sounds = this.sounds.filter((s) => s.id !== id);
    this.persist();
    try {
      rmSync(this.fileOf(sound), { force: true });
    } catch (err) {
      this.log?.warn({ err, id }, "could not delete a sound file");
    }
    return true;
  }

  read(id: string): { body: Buffer; contentType: SoundType } | null {
    const sound = this.sounds.find((s) => s.id === id);
    if (!sound) return null;
    try {
      return {
        body: readFileSync(this.fileOf(sound)),
        contentType: sound.contentType,
      };
    } catch {
      return null;
    }
  }
}
