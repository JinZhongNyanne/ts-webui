/**
 * Runs the real service worker (public/sw.js) outside a browser: the worker
 * globals it expects are stubbed, and its events are dispatched by hand.
 *
 * The point of most of these is what the worker must NOT do. A worker that
 * cached the page would bring back the blank-page-after-a-redeploy bug the
 * hub's cache rules exist to prevent (see apps/hub/src/http/web-ui.ts), and a
 * worker that cached session-scoped URLs would serve one session's files to
 * the next.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { stampServiceWorker } from "./swBuildId";

const ORIGIN = "https://ts.example";

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  destination: string;
}

interface FakeResponse {
  status: number;
  type: string;
  body: string;
  clone(): FakeResponse;
}

function request(path: string, overrides: Partial<FakeRequest> = {}): FakeRequest {
  return {
    url: path.startsWith("http") ? path : `${ORIGIN}${path}`,
    method: "GET",
    mode: "cors",
    destination: "script",
    ...overrides,
  };
}

function response(body: string, status = 200): FakeResponse {
  const res: FakeResponse = { status, type: "basic", body, clone: () => ({ ...res }) };
  return res;
}

/** Just enough of the Cache API: keyed by request URL, like the real one. */
function fakeCaches() {
  const stores = new Map<string, Map<string, FakeResponse>>();
  return {
    stores,
    open: async (name: string) => {
      const store = stores.get(name) ?? new Map<string, FakeResponse>();
      stores.set(name, store);
      return {
        match: async (req: FakeRequest) => store.get(req.url),
        put: async (req: FakeRequest, res: FakeResponse) => void store.set(req.url, res),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
}

const source = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

/** What the build writes into the worker; see ./swBuildId and vite.config.ts. */
const BUILD_ID = "aaaaaaaaaaaa";
const PREVIOUS_BUILD_ID = "bbbbbbbbbbbb";

interface WorkerOptions {
  /** The build this copy of the worker was stamped by. */
  readonly buildId?: string;
  /** Shared between two workers to play a redeploy: the browser keeps its caches. */
  readonly caches?: ReturnType<typeof fakeCaches>;
}

function loadWorker(netHandler?: (req: FakeRequest) => FakeResponse, options: WorkerOptions = {}) {
  const listeners = new Map<string, (event: unknown) => void>();
  const caches = options.caches ?? fakeCaches();
  const stamped = stampServiceWorker(source, options.buildId ?? BUILD_ID);
  const fetched: string[] = [];
  const claimed = { install: false, activate: false };
  const net = async (req: FakeRequest) => {
    fetched.push(req.url);
    return netHandler ? netHandler(req) : response(`body of ${req.url}`);
  };
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn),
    skipWaiting: () => void (claimed.install = true),
    clients: { claim: async () => void (claimed.activate = true) },
    location: { origin: ORIGIN },
  };
  new Function("self", "caches", "fetch", stamped)(self, caches, net);

  async function dispatch(type: string, req?: FakeRequest) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<FakeResponse> | null = null;
    const event = {
      request: req,
      respondWith: (p: Promise<FakeResponse>) => void (responded = p),
      waitUntil: (p: Promise<unknown>) => void waits.push(p),
    };
    listeners.get(type)?.(event);
    await Promise.all(waits);
    return { responded: responded as Promise<FakeResponse> | null };
  }

  return { listeners, caches, fetched, claimed, dispatch };
}

let worker: ReturnType<typeof loadWorker>;

beforeEach(() => {
  worker = loadWorker();
});

/** Every response the worker has stored, across all of its caches. */
function cachedUrls(w: ReturnType<typeof loadWorker>): string[] {
  return [...w.caches.stores.values()].flatMap((store) => [...store.keys()]);
}

describe("the service worker's handlers", () => {
  it("has a fetch handler, without which no browser offers to install", () => {
    expect(worker.listeners.get("fetch")).toBeTypeOf("function");
    expect(worker.listeners.get("install")).toBeTypeOf("function");
    expect(worker.listeners.get("activate")).toBeTypeOf("function");
  });

  it("takes over at once rather than leaving a stale worker in charge", async () => {
    await worker.dispatch("install");
    await worker.dispatch("activate");
    expect(worker.claimed).toEqual({ install: true, activate: true });
  });

  it("deletes its own older caches and leaves anything else alone", async () => {
    worker.caches.stores.set("jinz-assets-v0", new Map());
    worker.caches.stores.set("some-other-app", new Map());
    const asset = request("/assets/index-abc.js");
    await (
      await worker.dispatch("fetch", asset)
    ).responded;
    await worker.dispatch("activate");
    const names = await worker.caches.keys();
    expect(names).not.toContain("jinz-assets-v0");
    expect(names).toContain("some-other-app");
    expect(names.some((n) => n.startsWith("jinz-assets-"))).toBe(true);
  });
});

describe("clearing up after a redeploy", () => {
  /** The previous build's worker, having cached one of that build's assets. */
  async function previousBuild(caches = fakeCaches()) {
    const old = loadWorker(undefined, { buildId: PREVIOUS_BUILD_ID, caches });
    await old.dispatch("activate");
    await (
      await old.dispatch("fetch", request("/assets/index-OLD.js"))
    ).responded;
    return caches;
  }

  it("names its cache after the build it was stamped with", async () => {
    await (
      await worker.dispatch("fetch", request("/assets/index-abc.js"))
    ).responded;
    expect(await worker.caches.keys()).toEqual([`jinz-assets-${BUILD_ID}`]);
  });

  it("deletes an earlier build's cache on activate, keeps its own, and leaves others alone", async () => {
    const caches = await previousBuild();
    caches.stores.set("jinz-assets-v1", new Map()); // from when the version was bumped by hand
    caches.stores.set("some-other-app", new Map());
    const next = loadWorker(undefined, { caches });
    await (
      await next.dispatch("fetch", request("/assets/index-NEW.js"))
    ).responded;
    await next.dispatch("activate");
    expect((await caches.keys()).sort()).toEqual([`jinz-assets-${BUILD_ID}`, "some-other-app"]);
    expect(cachedUrls(next)).toEqual([`${ORIGIN}/assets/index-NEW.js`]);
  });

  it("keeps the cache when a redeploy rebuilt exactly the same assets", async () => {
    const caches = await previousBuild();
    const same = loadWorker(undefined, { buildId: PREVIOUS_BUILD_ID, caches });
    await same.dispatch("activate");
    expect(cachedUrls(same)).toEqual([`${ORIGIN}/assets/index-OLD.js`]);
  });
});

describe("what the service worker caches", () => {
  it("serves a hashed asset from the cache on the second visit", async () => {
    const asset = request("/assets/index-abc.js");
    const first = await (await worker.dispatch("fetch", asset)).responded;
    expect(first?.body).toBe(`body of ${ORIGIN}/assets/index-abc.js`);
    const second = await (await worker.dispatch("fetch", asset)).responded;
    expect(second?.body).toBe(first?.body);
    expect(worker.fetched).toHaveLength(1);
  });

  it("never caches or answers the page: a stale page asks for scripts that are gone", async () => {
    for (const req of [
      request("/", { mode: "navigate", destination: "document" }),
      request("/index.html", { destination: "document" }),
      request("/some/client/route", { mode: "navigate", destination: "document" }),
    ]) {
      expect((await worker.dispatch("fetch", req)).responded, req.url).toBeNull();
    }
    expect(cachedUrls(worker)).toEqual([]);
  });

  it("leaves the API, the websocket and session-scoped files to the network", async () => {
    for (const req of [
      request("/api/config"),
      request("/ws"),
      request("/files/s-123/avatar.png"),
      request("/worklets/mixer.js"),
      request("https://elsewhere.example/assets/x.js"),
    ]) {
      expect((await worker.dispatch("fetch", req)).responded, req.url).toBeNull();
    }
    expect(worker.fetched).toEqual([]);
    expect(cachedUrls(worker)).toEqual([]);
  });

  it("stays out of the way of anything that is not a plain GET", async () => {
    const post = request("/assets/index-abc.js", { method: "POST" });
    expect((await worker.dispatch("fetch", post)).responded).toBeNull();
  });

  it("does not keep a response that failed, so a 404 cannot become permanent", async () => {
    const missing = loadWorker(() => response("not found", 404));
    const gone = request("/assets/index-OLD.js");
    const res = await (await missing.dispatch("fetch", gone)).responded;
    expect(res?.status).toBe(404);
    expect(cachedUrls(missing)).toEqual([]);
    await (
      await missing.dispatch("fetch", gone)
    ).responded;
    expect(missing.fetched).toHaveLength(2);
  });
});
