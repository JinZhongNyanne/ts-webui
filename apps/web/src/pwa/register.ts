/**
 * Registers the service worker, which is what makes the app installable.
 *
 * Registration fails for perfectly ordinary reasons — a private window, an
 * http origin, a browser without service workers, an extension blocking the
 * request, a worker file that 404s on a half-finished deploy — and none of
 * them is a reason for the app not to start. So every failure is reported and
 * swallowed here, and this is called after the app has mounted.
 *
 * Production only: the dev server and the unit and e2e runs would otherwise
 * get a worker that caches `/assets/*` across builds, which is exactly the
 * kind of stale-bundle confusion the hub's cache rules exist to avoid.
 */
export const SERVICE_WORKER_URL = "/sw.js";
/** The whole app: the worker must control every route, not just `/sw.js`'s folder. */
export const SERVICE_WORKER_SCOPE = "/";

/** The part of `navigator.serviceWorker` this module needs; absent on unsupported browsers. */
export interface ServiceWorkerRegistrar {
  register(url: string, options?: { scope?: string }): Promise<unknown>;
}

export interface RegisterDeps {
  readonly container: ServiceWorkerRegistrar | undefined;
  readonly isProduction: boolean;
  readonly log?: (message: string, detail?: unknown) => void;
}

export type RegisterOutcome = "registered" | "skipped" | "unsupported" | "failed";

export async function registerServiceWorker(deps: RegisterDeps): Promise<RegisterOutcome> {
  if (!deps.isProduction) return "skipped";
  if (!deps.container) return "unsupported";
  const log = deps.log ?? ((message: string, detail?: unknown) => console.warn(message, detail));
  try {
    // Inside the try: a container can reject asynchronously or throw at once
    // (a SecurityError on an insecure origin does the latter).
    await deps.container.register(SERVICE_WORKER_URL, { scope: SERVICE_WORKER_SCOPE });
    return "registered";
  } catch (err) {
    log("[pwa] service worker registration failed; the app is not installable", err);
    return "failed";
  }
}

/** Reads the browser's own globals; the app calls this once, after mounting. */
export function registerServiceWorkerFromApp(): Promise<RegisterOutcome> {
  return registerServiceWorker({
    container: typeof navigator === "undefined" ? undefined : navigator.serviceWorker,
    isProduction: import.meta.env.PROD,
  });
}
