/**
 * What the hub knows about each bot that the bot itself does not: which bots
 * play personal FM or a recommendation in locked order (radio.ts), who started
 * that FM, and which TeamSpeak user requested which song (requesters.ts).
 *
 * Kept per bot URL and written to one JSON file under HUB_DATA_DIR, so a hub
 * restart no longer forgets that FM is playing (the bot keeps playing it) and
 * the panel keeps showing the lock and the requesters. Without a file (tests)
 * it lives in memory only.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MusicRadio } from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { RequesterBook, type RequesterBookJson } from "./requesters.js";

/**
 * Bot URLs remembered. Browsers may name any bot, so the least recently used
 * are forgotten past this; the pool never runs more bridges than this at once.
 */
const MAX_URLS = 64;
/** Writes are batched: a playlist credits dozens of songs in one go. */
const SAVE_DELAY_MS = 1000;
const FILE_VERSION = 1;

/** One bot URL's state. The maps are live: the bridge reads and writes them. */
export interface BotUrlState {
  readonly radios: Map<string, MusicRadio>;
  /** Who started the FM on each bot, credited with the songs it adds later. */
  readonly radioOwners: Map<string, string>;
  readonly requesters: RequesterBook;
}

interface StoredUrlState {
  radios?: Record<string, unknown>;
  radioOwners?: Record<string, unknown>;
  requesters?: RequesterBookJson;
}

interface StoredFile {
  version: number;
  bots: Record<string, StoredUrlState>;
}

function isRadio(value: unknown): value is MusicRadio {
  return value === "fm" || value === "recommend";
}

function stringEntries(record: unknown): Array<[string, string]> {
  if (typeof record !== "object" || record === null) return [];
  return Object.entries(record as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === "string" && e[1] !== "",
  );
}

function fromStored(stored: StoredUrlState): BotUrlState {
  return {
    radios: new Map(
      stringEntries(stored.radios).filter((e): e is [string, MusicRadio] => isRadio(e[1])),
    ),
    radioOwners: new Map(stringEntries(stored.radioOwners)),
    requesters: RequesterBook.fromJson(stored.requesters),
  };
}

function emptyState(): BotUrlState {
  return { radios: new Map(), radioOwners: new Map(), requesters: new RequesterBook() };
}

export class MusicStateStore {
  private readonly states = new Map<string, BotUrlState>();
  private timer: NodeJS.Timeout | null = null;

  /** `file` null keeps everything in memory. */
  constructor(
    private readonly file: string | null = null,
    private readonly log?: Logger,
  ) {
    if (file) this.load(file);
  }

  /** The live state of one bot URL, created on first use. */
  forUrl(url: string): BotUrlState {
    const state = this.states.get(url) ?? emptyState();
    // Re-inserting keeps the map in order of use, oldest first.
    this.states.delete(url);
    this.states.set(url, state);
    while (this.states.size > MAX_URLS) this.states.delete(this.states.keys().next().value!);
    return state;
  }

  /** Drops a URL nobody uses that has nothing worth keeping. */
  forgetIfEmpty(url: string): void {
    const s = this.states.get(url);
    if (s && s.radios.size === 0 && Object.keys(s.requesters.toJson()).length === 0) {
      this.states.delete(url);
    }
  }

  /** Something changed; written out shortly, together with whatever follows. */
  changed(): void {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.timer.unref();
  }

  /** Writes now (shutdown). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.file) return;
    // fromEntries defines keys, so a URL or bot id of "__proto__" stays data.
    const data: StoredFile = {
      version: FILE_VERSION,
      bots: Object.fromEntries(
        [...this.states].map(([url, s]) => [
          url,
          {
            radios: Object.fromEntries(s.radios),
            radioOwners: Object.fromEntries(s.radioOwners),
            requesters: s.requesters.toJson(),
          },
        ]),
      ),
    };
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      // Write-then-rename, so a crash mid-write leaves the previous file intact.
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
    } catch (err) {
      this.log?.warn({ err, file: this.file }, "could not save music state");
    }
  }

  private load(file: string): void {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      return; // first run
    }
    try {
      const parsed = JSON.parse(raw) as Partial<StoredFile>;
      if (typeof parsed.bots !== "object" || parsed.bots === null) return;
      for (const [url, stored] of Object.entries(parsed.bots).slice(-MAX_URLS)) {
        if (typeof stored === "object" && stored !== null) {
          this.states.set(url, fromStored(stored));
        }
      }
    } catch (err) {
      this.log?.warn({ err, file }, "music state file is unreadable; starting empty");
    }
  }
}
