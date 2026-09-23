/**
 * The one place a store keeps the bytes people upload: a `blobs/` directory
 * beside its JSON index, rather than the index's own directory.
 *
 * Mixing the two was never a data bug, but it made every clean-up job walk a
 * directory holding both kinds of file, and a sweep that deletes "everything
 * that is not the index" is one rename away from deleting the next index file
 * someone adds. With the uploads one level down, a sweep reads only the blobs
 * directory and can never see the index at all.
 *
 * Existing hubs have those files in the root, and the index still names them,
 * so a version that only changed the path would make every sound, avatar and
 * icon vanish. Hence the migration here, on construction: a one-off move, run
 * before anything reads a blob, so the rest of the store has a single layout
 * to think about. The alternative — a read fallback to the old path — would
 * have left both layouts live in every reader and delete path indefinitely,
 * which is more code to get wrong for a directory of a few hundred files that
 * moves in milliseconds.
 *
 * Crash-safe and idempotent because the only thing it ever does is rename one
 * file, which is atomic: a killed hub leaves each file either where it was or
 * where it is going, never half-moved and never lost. The second run finds
 * nothing left to move. A store that was laid out this way from the start has
 * nothing in the root to move at all and passes `null` instead of a predicate,
 * which says so outright where a predicate matching nothing would only look
 * like an oversight. It moves only names the store itself would write —
 * `isBlobName` decides — so an index, its `.tmp`, a subdirectory or a file
 * somebody dropped in by hand stays exactly where it is, and nothing is ever
 * overwritten or deleted: a name already taken in `blobs/` is the live one, so
 * the root copy is left behind rather than clobbering it.
 */
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";

/** Name of the subdirectory, inside each store's directory, holding its uploads. */
export const BLOBS_DIR = "blobs";

/** True for a file name this store writes itself, i.e. one that holds uploaded bytes. */
export type BlobNameCheck = (name: string) => boolean;

/**
 * Makes sure `<dir>/blobs` exists, moves any blob an older version left in
 * `dir` into it, and returns the blobs directory's path. `isBlobName` is null
 * for a store that never used the old layout, which then only gets the
 * directory made.
 */
export function openBlobDir(dir: string, isBlobName: BlobNameCheck | null, log?: Logger): string {
  const blobsDir = path.join(dir, BLOBS_DIR);
  mkdirSync(blobsDir, { recursive: true });
  if (!isBlobName) return blobsDir;
  for (const name of strayBlobs(dir, isBlobName, log)) {
    const from = path.join(dir, name);
    const to = path.join(blobsDir, name);
    try {
      if (exists(to)) {
        log?.warn({ dir, name }, "leaving a stray upload alone: the blobs directory has that name");
        continue;
      }
      renameSync(from, to);
    } catch (err) {
      // Worth a loud line each start-up: the index still points at this file,
      // so whoever uploaded it sees a gap until someone looks at the disk.
      log?.warn({ err, dir, name }, "could not move an upload into the blobs directory");
    }
  }
  return blobsDir;
}

/** The names in `dir` that belong one level down; directories are never touched. */
function strayBlobs(dir: string, isBlobName: BlobNameCheck, log?: Logger): readonly string[] {
  let entries: readonly string[];
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isBlobName(entry.name))
      .map((entry) => entry.name);
  } catch (err) {
    log?.warn({ err, dir }, "could not list a store directory for stray uploads");
    return [];
  }
  return entries;
}

function exists(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes every file in `blobsDir` that `kept` does not name: the blobs left
 * behind when a hub died between writing an upload and writing its index.
 *
 * Only ever called with a `kept` built from an index that was read and
 * understood — see `IndexState` — because a `kept` built from an index nobody
 * could read names nothing, and this would then delete the lot.
 */
export function sweepBlobDir(blobsDir: string, kept: ReadonlySet<string>, log?: Logger): void {
  let names: readonly string[];
  try {
    names = readdirSync(blobsDir);
  } catch (err) {
    log?.warn({ err, dir: blobsDir }, "could not list a blobs directory to sweep it");
    return;
  }
  for (const name of names) {
    if (kept.has(name)) continue;
    try {
      rmSync(path.join(blobsDir, name), { force: true });
    } catch (err) {
      log?.warn({ err, dir: blobsDir, name }, "could not delete an unreferenced upload");
    }
  }
}
