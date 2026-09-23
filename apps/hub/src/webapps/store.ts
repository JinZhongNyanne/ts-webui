import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { MAX_APPS, appName, normalizeAppUrl, type SharedApp } from "@jinz/protocol";
import type { Logger } from "../logger.js";
import { openBlobDir } from "../storage/blob-dir.js";
import { readIndexFile, type IndexState } from "../storage/index-file.js";

interface StoredIcon {
  contentType: string;
  /** Bumped on every fetch, so browsers re-load instead of using a stale cache. */
  rev: number;
  file: string;
}

interface StoredApp {
  id: string;
  name: string;
  url: string;
  addedBy: string;
  addedAt: number;
  icon?: StoredIcon;
}

export type AddAppResult = { ok: true; app: SharedApp } | { ok: false; reason: "full" | "exists" };

const ICON_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/svg+xml": "svg",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Ids name files on disk, so only our own UUID shape is ever accepted. */
const ID_PATTERN = /^[0-9a-f-]{36}$/;

const KNOWN_EXTENSIONS = new Set([...Object.values(ICON_EXTENSIONS), "bin"]);

/** `<id>.<ext>` and nothing else: `apps.json`, its `.tmp` and strangers fail this. */
function isIconFile(name: string): boolean {
  const cut = name.lastIndexOf(".");
  if (cut < 0) return false;
  return ID_PATTERN.test(name.slice(0, cut)) && KNOWN_EXTENSIONS.has(name.slice(cut + 1));
}

/**
 * The Apps window's websites, shared by everyone on this hub, in the order
 * they were added. A JSON index, `apps.json`, plus one icon file per site
 * under `blobs/`; both rewritten on every change, which is plenty for a list
 * capped at MAX_APPS.
 *
 * Icons fetched by an older hub sit beside the index instead; `openBlobDir`
 * moves those down on construction, before anything serves one.
 *
 * An index that exists but cannot be read or parsed puts the store into its
 * "unreadable" state, where it refuses to write: see `IndexState` for why the
 * next write would otherwise replace every site on the hub with one.
 */
export class AppStore {
  private apps: StoredApp[] = [];
  private readonly indexFile: string;
  private readonly blobsDir: string;
  private indexState: IndexState = "empty";

  constructor(
    dir: string,
    private readonly log?: Logger,
  ) {
    this.indexFile = path.join(dir, "apps.json");
    this.blobsDir = openBlobDir(dir, isIconFile, log);
    this.load();
  }

  private load(): void {
    const read = readIndexFile(this.indexFile);
    if (read.state === "empty") return; // first run
    if (read.state === "unreadable") {
      this.unusable(read.err, "could not read the apps index; keeping the file as it is");
      return;
    }
    try {
      const parsed = JSON.parse(read.raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error("not a list");
      for (const item of parsed as StoredApp[]) {
        if (!item || typeof item.id !== "string" || !ID_PATTERN.test(item.id)) continue;
        if (typeof item.url !== "string" || typeof item.name !== "string") continue;
        const checked = normalizeAppUrl(item.url, []);
        if ("error" in checked) continue;
        this.apps.push({ ...item, url: checked.url, name: appName(item.name, checked.url) });
      }
      this.indexState = "loaded";
    } catch (err) {
      this.apps = [];
      this.unusable(err, "apps index is corrupt; keeping the file as it is");
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
      // load that failed, i.e. throw away every site the file still holds.
      this.log?.error(
        { indexFile: this.indexFile },
        "not writing over an apps index we could not read",
      );
      return;
    }
    // Write-then-rename, so a crash mid-write leaves the old list, not half a file.
    const tmp = `${this.indexFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.apps, null, 2));
    renameSync(tmp, this.indexFile);
  }

  list(): SharedApp[] {
    return this.apps.map(describe);
  }

  /** `url` must already be normalized and vetted by the caller. */
  add(name: string, url: string, addedBy: string, now = Date.now()): AddAppResult {
    if (this.apps.some((a) => a.url === url)) return { ok: false, reason: "exists" };
    if (this.apps.length >= MAX_APPS) return { ok: false, reason: "full" };
    const app: StoredApp = {
      id: randomUUID(),
      name: appName(name, url),
      url,
      addedBy,
      addedAt: now,
    };
    this.apps = [...this.apps, app];
    this.persist();
    return { ok: true, app: describe(app) };
  }

  remove(id: string): boolean {
    const app = this.apps.find((a) => a.id === id);
    if (!app) return false;
    this.apps = this.apps.filter((a) => a.id !== id);
    if (app.icon) this.unlink(app.icon.file);
    this.persist();
    return true;
  }

  /** Stores a freshly fetched icon; null when the site was removed meanwhile. */
  setIcon(id: string, body: Buffer, contentType: string): SharedApp | null {
    const index = this.apps.findIndex((a) => a.id === id);
    const app = this.apps[index];
    if (!app) return null;
    const file = `${id}.${ICON_EXTENSIONS[contentType] ?? "bin"}`;
    writeFileSync(path.join(this.blobsDir, file), body);
    if (app.icon && app.icon.file !== file) this.unlink(app.icon.file);
    const next: StoredApp = { ...app, icon: { contentType, rev: (app.icon?.rev ?? 0) + 1, file } };
    this.apps = this.apps.map((a, i) => (i === index ? next : a));
    this.persist();
    return describe(next);
  }

  readIcon(id: string): { body: Buffer; contentType: string } | null {
    const icon = this.apps.find((a) => a.id === id)?.icon;
    if (!icon) return null;
    try {
      return {
        body: readFileSync(path.join(this.blobsDir, icon.file)),
        contentType: icon.contentType,
      };
    } catch {
      return null;
    }
  }

  private unlink(file: string): void {
    try {
      rmSync(path.join(this.blobsDir, file), { force: true });
    } catch (err) {
      this.log?.warn({ err, file }, "could not delete an app icon");
    }
  }
}

function describe(app: StoredApp): SharedApp {
  return {
    id: app.id,
    name: app.name,
    url: app.url,
    iconRev: app.icon ? app.icon.rev : null,
    addedBy: app.addedBy,
    addedAt: app.addedAt,
  };
}
