/**
 * Reading a store's JSON index, and — the whole point of this file — telling
 * "there is no index yet" apart from "there is one and I could not read it".
 *
 * Every store here began with `try { readFileSync(index) } catch { return }`,
 * commented "first run". That catch swallows ENOENT, which really is a first
 * run, alongside EIO, EACCES, EBUSY and a truncated read, which are not: the
 * store then carries on with an empty list as though the hub had never stored
 * anything. Two things downstream take that at its word. A `sweep` deletes
 * every file in the blobs directory the index does not name, so one bad read
 * at boot deletes every avatar, entry sound and sticker on the hub. And the
 * next `persist` writes the empty list over the index, so the entries are gone
 * from disk too, and the operator has nothing left to recover from.
 *
 * So a load reports which of the three it got, and the caller keeps the state:
 * on "unreadable" it must sweep nothing and write nothing, leaving the disk
 * exactly as it found it for somebody to look at. Refusing the write costs a
 * restart's worth of changes — uploads in that session serve from memory but
 * do not survive — which is the cheap half of the trade against deleting
 * everything, and it is the operator's file, not ours, to overwrite.
 *
 * An unparseable index is the same situation and gets the same answer: the
 * bytes are there, they mean something to whoever wrote them, and half a file
 * is what a power cut during a write leaves behind.
 */
import { readFileSync } from "node:fs";

/**
 * What a store knows about its index: never written, read and understood, or
 * present but unusable. Only "unreadable" makes deleting and rewriting unsafe.
 */
export type IndexState = "empty" | "loaded" | "unreadable";

/** The outcome of one read: the bytes on "loaded", the reason on "unreadable". */
export type IndexRead =
  | { readonly state: "empty" }
  | { readonly state: "loaded"; readonly raw: string }
  | { readonly state: "unreadable"; readonly err: unknown };

/** True for the one error that means "nobody has written this index yet". */
function isMissing(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "ENOENT";
}

/**
 * Reads `file` as UTF-8, reporting a missing file as "empty" and every other
 * failure as "unreadable" rather than folding the two together.
 */
export function readIndexFile(file: string): IndexRead {
  try {
    return { state: "loaded", raw: readFileSync(file, "utf8") };
  } catch (err) {
    return isMissing(err) ? { state: "empty" } : { state: "unreadable", err };
  }
}
