/*
 * Service worker: it exists to make the app installable, and is deliberately
 * no cleverer than that.
 *
 * Chrome only offers to install an app whose registered worker has a `fetch`
 * handler, so there has to be one — but a caching worker is the fastest way
 * back to the bug the hub's cache rules were written to prevent (see the note
 * at the top of apps/hub/src/http/web-ui.ts). A cached page comes back after
 * a redeploy asking for the previous build's hashed scripts, which no longer
 * exist, and the app never starts. A worker's cache outlives a hard reload,
 * so that version of the bug would be worse: the user could not clear it.
 *
 * Hence one rule, and everything else follows from it: only `/assets/*` is
 * ever cached, because those names carry a content hash and so can never go
 * stale, and everything else — the page, the API, the websocket, the audio
 * worklets, uploaded files — is passed straight through to the network as if
 * no worker were installed. Uploaded-file URLs carry the session id (see the
 * `no-referrer` note in apps/hub/src/security/headers.ts), so caching them
 * would hand one session's files to the next.
 *
 * This worker runs under its own Content-Security-Policy, served for this
 * path by the hub; without it `default-src 'none'` would block every fetch
 * it makes.
 */

/**
 * The build this worker shipped with, written in at build time by the plugin
 * in vite.config.ts (see apps/web/src/pwa/swBuildId.ts). The cache is named
 * after it, and activation deletes every other cache of ours: without that,
 * each deploy would leave a whole build's worth of hashed assets behind for
 * good. A redeploy of identical assets keeps the same id, and so its cache.
 * Unbuilt, as the dev server serves it, the placeholder stays — harmless,
 * since the worker is only ever registered in production.
 */
const BUILD_ID = "__JINZ_BUILD_ID__";
/** Only caches with this prefix are ours to delete on activation. */
const CACHE_PREFIX = "jinz-assets-";
const ASSET_CACHE = `${CACHE_PREFIX}${BUILD_ID}`;

/** Vite writes content-hashed file names here, and only here. */
const HASHED_ASSET_PREFIX = "/assets/";

/**
 * Taking over straight away is safe here because of the rule above: a new
 * worker can only ever serve immutable, content-hashed URLs, so it never
 * hands a page a file other than the one it named. It does not keep a page
 * from the previous build working, though: activation deletes that build's
 * cache and the hub no longer serves its assets, so a chunk such a page has
 * not loaded yet fails to load. That failure is the one a redeploy causes
 * with or without a worker, and the stale-chunk recovery in
 * apps/web/src/main.ts (the `vite:preloadError` handler) covers it: a reload
 * before connecting, a notice mid-call. Waiting instead would leave a worker
 * with a known-bad cache in charge until every tab had been closed.
 */
self.addEventListener("install", () => {
  // Nothing is pre-cached: the only thing worth pre-caching is the page,
  // and the page is the one thing that must never be cached.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(discardOldCaches().then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  // Not calling respondWith() at all lets the request go to the network
  // untouched, which is what we want for everything but hashed assets.
  if (!isHashedAsset(event.request)) return;
  event.respondWith(cacheFirst(event.request));
});

/** True only for a plain GET of a content-hashed file from this origin. */
function isHashedAsset(request) {
  if (request.method !== "GET") return false;
  // A navigation can be aimed at any path, including /assets/, and must never
  // be answered from the cache.
  if (request.mode === "navigate" || request.destination === "document") return false;
  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    /* An unparseable URL is nothing we can reason about: leave it be. */
    return false;
  }
  if (url.origin !== self.location.origin) return false;
  return url.pathname.startsWith(HASHED_ASSET_PREFIX);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  // If this throws we let it: the request then fails exactly as it would
  // without a worker, which is what boot.js's recovery guard expects to see.
  const response = await fetch(request);
  if (isStorable(response)) await store(cache, request, response);
  return response;
}

/**
 * A 404 for a previous build's script is a normal thing to see here, and it
 * must stay a 404 on the next attempt rather than becoming permanent. Partial
 * and opaque responses are no use to us either.
 */
function isStorable(response) {
  return Boolean(response) && response.status === 200 && response.type !== "opaque";
}

async function store(cache, request, response) {
  try {
    await cache.put(request, response.clone());
  } catch (err) {
    // A full quota or a private window that refuses storage must never turn a
    // perfectly good response into a failed one; serving it is all that matters.
    console.warn("[sw] could not cache", request.url, err);
  }
}

async function discardOldCaches() {
  let names;
  try {
    names = await caches.keys();
  } catch (err) {
    /* No storage, nothing to clean up; the worker still passes traffic. */
    console.warn("[sw] could not list caches", err);
    return;
  }
  const stale = names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== ASSET_CACHE);
  await Promise.all(stale.map((name) => caches.delete(name).catch(() => undefined)));
}
