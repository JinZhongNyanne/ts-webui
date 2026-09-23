import { afterEach, describe, expect, it, vi } from "vitest";
import { BotBridge, isTlsError, pinnedLookup } from "./BotBridge.js";
import { RequesterBook } from "./requesters.js";
import type { Logger } from "../logger.js";

const silent = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  trace: () => undefined,
  child: () => silent,
} as unknown as Logger;

interface Seen {
  url: string;
  method: string;
  headers: Headers;
  redirect: RequestRedirect | undefined;
}

/** Stubs global fetch; every call logs in fine and answers `{ ok: true }`. */
function stubFetch(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      seen.push({
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        redirect: init.redirect,
      });
      if (url.endsWith("/api/session/login") || url.endsWith("/api/session/guest")) {
        return new Response("{}", {
          status: 200,
          headers: { "set-cookie": "sid=abc; Path=/; HttpOnly" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return seen;
}

function bridge(baseUrl: string): BotBridge {
  return new BotBridge({ baseUrl, username: "svc", password: "pw", logger: silent });
}

afterEach(() => vi.unstubAllGlobals());

describe("BotBridge origin header", () => {
  it("sends the bot's own origin on a mutating request so its CSRF gate accepts it", async () => {
    const seen = stubFetch();
    const r = await bridge("http://musicbot:3000/").request("POST", "/api/player/b1/pause");
    expect(r.status).toBe(200);
    const post = seen.find((s) => s.method === "POST" && s.url.endsWith("/pause"));
    expect(post?.headers.get("origin")).toBe("http://musicbot:3000");
  });

  it("sends the same origin on the login call", async () => {
    const seen = stubFetch();
    await bridge("https://bot.example.com").request("GET", "/api/bot");
    const login = seen.find((s) => s.url.endsWith("/api/session/login"));
    expect(login?.headers.get("origin")).toBe("https://bot.example.com");
  });

  it("uses only the origin part of a base URL that carries a path prefix", async () => {
    const seen = stubFetch();
    await bridge("http://host.local:8080/musicbot").request("POST", "/api/player/b1/next");
    const post = seen.find((s) => s.method === "POST" && s.url.endsWith("/next"));
    expect(post?.url).toBe("http://host.local:8080/musicbot/api/player/b1/next");
    expect(post?.headers.get("origin")).toBe("http://host.local:8080");
  });
});

describe("BotBridge redirects", () => {
  it("never follows a redirect: the guard vetted the URL, not its 3xx target", async () => {
    const seen = stubFetch();
    await bridge("http://musicbot:3000").request("GET", "/api/bot");
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) expect(call.redirect).toBe("error");
  });
});

describe("pinnedLookup", () => {
  it("answers every hostname with the pinned address", async () => {
    const lookup = pinnedLookup("203.0.113.5");
    const single = await new Promise<unknown[]>((resolve) =>
      lookup("bot.example.org", { family: 0 }, (...args: unknown[]) => resolve(args)),
    );
    expect(single).toEqual([null, "203.0.113.5", 4]);
    const all = await new Promise<unknown[]>((resolve) =>
      lookup("bot.example.org", { all: true, family: 0 }, (...args: unknown[]) => resolve(args)),
    );
    expect(all).toEqual([null, [{ address: "203.0.113.5", family: 4 }]]);
  });
});

describe("isTlsError", () => {
  it("recognises an expired certificate, however deeply it is wrapped", () => {
    expect(isTlsError(Object.assign(new Error("x"), { code: "CERT_HAS_EXPIRED" }))).toBe(true);
    const wrapped = new Error("fetch failed", {
      cause: Object.assign(new Error("inner"), { code: "CERT_HAS_EXPIRED" }),
    });
    expect(isTlsError(wrapped)).toBe(true);
  });

  it("recognises a self-signed certificate", () => {
    expect(isTlsError(Object.assign(new Error("x"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }))).toBe(
      true,
    );
  });

  it("does not mistake a refused connection for a certificate problem", () => {
    expect(isTlsError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe(false);
    expect(isTlsError(new Error("plain"))).toBe(false);
    expect(isTlsError(undefined)).toBe(false);
  });

  it("reports a certificate failure as the bridge's unavailable reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch failed", {
          cause: Object.assign(new Error("inner"), { code: "CERT_HAS_EXPIRED" }),
        });
      }),
    );
    const b = new BotBridge({
      baseUrl: "https://bot.example.org:8443",
      username: "",
      password: "",
      logger: silent,
    });
    await b.start();
    b.stop();
    expect(b.available).toBe(false);
    expect(b.unavailableReason).toBe("hub.musicTlsError");
  });
});

describe("BotBridge requesters", () => {
  const song = (id: string, requestedBy = "svc") => ({ id, name: id, platform: "qq", requestedBy });

  /** A bridge whose bot names its session "svc" and reports queue `q` for b1. */
  function withQueue(q: () => unknown[], radios = new Map<string, "fm" | "recommend">()) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const json = (body: unknown) =>
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "set-cookie": "sid=abc; Path=/", "content-type": "application/json" },
          });
        if (url.endsWith("/api/session/login")) return json({});
        if (url.endsWith("/api/session/me")) return json({ username: "svc" });
        if (url.endsWith("/api/bot")) return json({ bots: [status()] });
        if (url.endsWith("/queue")) return json({ queue: q() });
        return json({});
      }),
    );
    const status = () => ({ id: "b1", currentSong: q()[0] ?? null });
    const state = {
      radios,
      radioOwners: new Map<string, string>(),
      requesters: new RequesterBook(),
    };
    const b = new BotBridge({
      baseUrl: "http://bot:3000",
      username: "svc",
      password: "pw",
      logger: silent,
      state,
    });
    return { b, state };
  }

  it("shows the TeamSpeak name on songs the bot credited to the hub's account", async () => {
    const { b } = withQueue(() => [song("1"), song("2", "admin")]);
    await (b as unknown as { login(): Promise<void>; refreshAll(): Promise<void> }).login();
    await (b as unknown as { refreshAll(): Promise<void> }).refreshAll();
    b.credit("b1", [song("1"), song("2", "admin")], "Alice", true);
    const [summary] = b.summaries();
    expect(summary!.queue.map((s) => s.requestedBy)).toEqual(["Alice", "admin"]);
    expect(summary!.status.currentSong?.requestedBy).toBe("Alice");
    b.stop();
  });

  it("credits songs FM adds later to whoever started it, and ends with an empty queue", async () => {
    let queue = [song("1")];
    const { b, state } = withQueue(() => queue);
    const internals = b as unknown as {
      login(): Promise<void>;
      refreshAll(): Promise<void>;
      onWsMessage(m: unknown): Promise<void>;
    };
    await internals.login();
    await internals.refreshAll();
    b.setRadio("b1", "fm", "Alice");
    queue = [song("1"), song("2")];
    await internals.onWsMessage({ type: "stateChange", status: { id: "b1" }, queue });
    expect(state.requesters.nameFor("b1", { id: "2", platform: "qq" })).toBe("Alice");

    // Bob queues a song while FM plays; the bot announces it only with FM's next top-up.
    b.credit("b1", [song("3")], "Bob");
    queue = [song("1"), song("2"), song("3"), song("4")];
    await internals.onWsMessage({ type: "stateChange", status: { id: "b1" }, queue });
    expect(state.requesters.nameFor("b1", { id: "3", platform: "qq" })).toBe("Bob");
    expect(state.requesters.nameFor("b1", { id: "4", platform: "qq" })).toBe("Alice");

    await internals.onWsMessage({ type: "stateChange", status: { id: "b1" }, queue: [] });
    expect(b.radioOf("b1")).toBeNull();
    expect(state.radioOwners.size).toBe(0);
    b.stop();
  });
});
