/**
 * Only the newest of overlapping asynchronous builds takes effect.
 *
 * The voice engine rebuilds its Opus encoder whenever the channel's codec or
 * quality changes, and building one is asynchronous. Two changes in quick
 * succession (a move to a channel with another codec, then its quality)
 * start two builds; without this the first to finish would be installed
 * wired to a queue the engine had already replaced, so its packets would be
 * dropped until the second landed, and whichever lost would never be closed.
 * Tearing the send path down mid-build supersedes the build the same way.
 *
 * A superseded build's product is closed as soon as it arrives, and its
 * failure is not reported: a newer build, or none, is what counts now.
 */

/** Anything a build makes that must be released when it is not used. */
export interface Closable {
  close(): void;
}

export interface LatestBuilds {
  /** Runs `build`; resolves to its product, or to null (the product closed) once overtaken. */
  run<T extends Closable>(build: () => Promise<T>): Promise<T | null>;
  /** Makes every build still in flight stale, without starting a new one. */
  supersede(): void;
}

export function createLatestBuilds(): LatestBuilds {
  let generation = 0;
  return {
    async run(build) {
      const mine = ++generation;
      let made;
      try {
        made = await build();
      } catch (err) {
        if (mine !== generation) return null;
        throw err;
      }
      if (mine === generation) return made;
      made.close();
      return null;
    },
    supersede() {
      generation++;
    },
  };
}
