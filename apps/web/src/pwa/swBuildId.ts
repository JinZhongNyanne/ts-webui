/**
 * Writes the build's id into the built service worker, so that its cache is
 * named after the build and each deploy deletes the one before it.
 *
 * `public/sw.js` is copied into the build untouched — Vite transforms nothing
 * under `public/` — so the id is stamped in by a small plugin in
 * vite.config.ts once the copy is on disk. The alternative, registering the
 * worker as `/sw.js?v=<id>` and reading the id back from its own URL, puts the
 * id in the page rather than the worker: a tab still open on the previous build
 * would register the new worker file under the old id, name the new build's
 * cache after the old one, and delete the new build's cache on activation.
 * Stamped into the file, the worker and its cache name can never disagree.
 *
 * The id is derived from the bundle's file names, which carry content hashes:
 * a rebuild of the same sources gives the same id and keeps the cache, and a
 * change to any asset gives a new one. Because the worker's bytes then differ,
 * the browser's own update check installs it without any help.
 *
 * Pure, with the digest passed in, so it can be tested without the build.
 */

/** Stands in for the id in `public/sw.js`, quotes included. */
export const SW_BUILD_ID_PLACEHOLDER = '"__JINZ_BUILD_ID__"';

/** Enough to tell builds apart; it only has to differ from the last few. */
const BUILD_ID_LENGTH = 12;

/** Hex, as a digest produces: nothing that could leave a string literal or a cache name. */
const SAFE_BUILD_ID = /^[0-9a-f]+$/;

/** The build's id, from the names of every file it emitted, in any order. */
export function buildIdOf(fileNames: readonly string[], digest: (input: string) => string): string {
  return digest([...fileNames].sort().join("\n")).slice(0, BUILD_ID_LENGTH);
}

/** The worker source with `buildId` in place of the placeholder; throws if either is wrong. */
export function stampServiceWorker(source: string, buildId: string): string {
  if (!SAFE_BUILD_ID.test(buildId)) {
    throw new Error(`[sw] refusing to stamp an unsafe build id: ${JSON.stringify(buildId)}`);
  }
  const parts = source.split(SW_BUILD_ID_PLACEHOLDER);
  // Failing the build is the point: without the id the worker would never
  // evict, and nothing at runtime would say so.
  if (parts.length !== 2) {
    throw new Error(
      `[sw] expected one ${SW_BUILD_ID_PLACEHOLDER} placeholder in sw.js, found ${parts.length - 1}`,
    );
  }
  return parts.join(`"${buildId}"`);
}
