import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { isAllowed, registerMusicRoutes, safeSubPath } from "./routes.js";
import type { PooledBridge } from "./BridgePool.js";
import type { MusicSong } from "@jinz/protocol";
import type { SessionRegistry } from "../session/registry.js";
import type { Logger } from "../logger.js";

describe("music proxy whitelist", () => {
  it("allows read and playback routes", () => {
    expect(isAllowed("GET", "/bot")).toBe(true);
    expect(isAllowed("GET", "/music/search")).toBe(true);
    expect(isAllowed("GET", "/music/playlist/123/detail")).toBe(true);
    expect(isAllowed("GET", "/player/abc/queue")).toBe(true);
    expect(isAllowed("POST", "/player/abc/add-song")).toBe(true);
    expect(isAllowed("DELETE", "/player/abc/queue/3")).toBe(true);
  });

  it("allows reading our own rights, and nothing else under /session", () => {
    expect(isAllowed("GET", "/session/me")).toBe(true);
    expect(isAllowed("POST", "/session/me")).toBe(false);
    expect(isAllowed("GET", "/session/login")).toBe(false);
    expect(isAllowed("POST", "/session/login")).toBe(false);
    expect(isAllowed("GET", "/session/logout")).toBe(false);
    expect(isAllowed("POST", "/session/logout")).toBe(false);
    expect(isAllowed("GET", "/session")).toBe(false);
    expect(isAllowed("GET", "/session/me/extra")).toBe(false);
  });

  it("allows the browse routes the discover/library tabs need", () => {
    expect(isAllowed("GET", "/music/recommend/playlists")).toBe(true);
    expect(isAllowed("GET", "/music/recommend/songs")).toBe(true);
    expect(isAllowed("GET", "/music/user/playlists")).toBe(true);
    expect(isAllowed("GET", "/music/bilibili/popular")).toBe(true);
    expect(isAllowed("GET", "/music/album/42")).toBe(true);
    expect(isAllowed("GET", "/player/abc/history")).toBe(true);
    expect(isAllowed("POST", "/player/abc/fm")).toBe(true);
    expect(isAllowed("POST", "/player/abc/play-playlist")).toBe(true);
    expect(isAllowed("POST", "/player/abc/playlist")).toBe(true);
    expect(isAllowed("POST", "/player/abc/add-by-id")).toBe(true);
  });

  it("allows reading the bot account's favourites, but never changing them", () => {
    expect(isAllowed("GET", "/favorites")).toBe(true);
    expect(isAllowed("POST", "/favorites")).toBe(false);
    expect(isAllowed("DELETE", "/favorites/7")).toBe(false);
    expect(isAllowed("GET", "/favorites/check")).toBe(false);
  });

  it("blocks management routes", () => {
    expect(isAllowed("POST", "/bot")).toBe(false);
    expect(isAllowed("DELETE", "/bot/abc")).toBe(false);
    expect(isAllowed("GET", "/users")).toBe(false);
    expect(isAllowed("POST", "/auth/cookie")).toBe(false);
    expect(isAllowed("PUT", "/player/abc/profile")).toBe(false);
    expect(isAllowed("POST", "/player/abc/../../users")).toBe(false);
  });
});

describe("music proxy path safety", () => {
  it("passes ordinary paths through", () => {
    expect(safeSubPath("player/abc/queue")).toBe("/player/abc/queue");
    expect(safeSubPath("music/song/id-1")).toBe("/music/song/id-1");
  });

  it("re-encodes what Fastify decoded, so odd song ids survive", () => {
    // Fastify hands the wildcard over decoded; putting "50%off" back into a URL
    // verbatim is not a valid escape.
    expect(safeSubPath("music/song/50%off")).toBe("/music/song/50%25off");
    expect(safeSubPath("music/song/a b")).toBe("/music/song/a%20b");
  });

  it("rejects the relative segment that would slip past the whitelist", () => {
    // `/player/../fm` passes the whitelist as "player/<id>/fm", and fetch()
    // then normalizes it to `/api/fm` — a route the whitelist never allowed.
    expect(isAllowed("POST", "/player/../fm")).toBe(true);
    expect(safeSubPath("player/../fm")).toBeNull();
    expect(safeSubPath("player/../../admin")).toBeNull();
    expect(safeSubPath("player/./x/queue")).toBeNull();
    expect(safeSubPath("player//queue")).toBeNull();
  });

  it("keeps an encoded separator inside one segment", () => {
    // Fastify decodes %2F into a separator before we see it, so the segment
    // count (and with it the whitelist match) is what it looks like.
    expect(safeSubPath("player/a/b/queue")).toBe("/player/a/b/queue");
    expect(isAllowed("GET", "/player/a/b/queue")).toBe(false);
  });
});

describe("music proxy handler", () => {
  const silent = {
    info: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    error: () => undefined,
    fatal: () => undefined,
    trace: () => undefined,
    child: () => silent,
  } as unknown as Logger;

  interface FakeSession {
    id: string;
    music: PooledBridge | null;
    tsSession?: { selfNickname: string };
  }

  async function build(session: FakeSession | undefined) {
    const app = Fastify();
    const registry = { getConnected: () => session } as unknown as SessionRegistry;
    registerMusicRoutes(app, { registry, logger: silent });
    await app.ready();
    return app;
  }

  it("answers 503 hub.musicUnreachable when the session has no bot", async () => {
    const app = await build({ id: "s1", music: null });
    const res = await app.inject({
      method: "GET",
      url: "/api/music-bot/bot",
      headers: { "x-session-id": "s1" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "hub.musicUnreachable" });
    await app.close();
  });

  it("proxies through the session's own bridge", async () => {
    const seen: string[] = [];
    const bridge: PooledBridge = {
      available: true,
      summaries: () => [],
      subscribe: () => () => undefined,
      start: async () => undefined,
      stop: () => undefined,
      radioOf: () => null,
      setRadio: () => undefined,
      queueOf: () => [],
      refreshQueue: async () => [],
      credit: () => undefined,
      relabel: (_path, body) => body,
      request: async (method, path) => {
        seen.push(`${method} ${path}`);
        return { status: 200, body: { ok: true } };
      },
    };
    const app = await build({ id: "s1", music: bridge });
    const res = await app.inject({
      method: "GET",
      url: "/api/music-bot/player/b1/queue?limit=5",
      headers: { "x-session-id": "s1" },
    });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual(["GET /api/player/b1/queue?limit=5"]);
    await app.close();
  });

  it("still requires a connected session", async () => {
    const app = await build(undefined);
    const res = await app.inject({ method: "GET", url: "/api/music-bot/bot" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  /** A bridge that answers every call with 200 and keeps its radio like the real one. */
  function radioBridge(seen: string[]): PooledBridge {
    const radios = new Map<string, "fm" | "recommend">();
    return {
      available: true,
      summaries: () => [],
      subscribe: () => () => undefined,
      start: async () => undefined,
      stop: () => undefined,
      radioOf: (id) => radios.get(id) ?? null,
      setRadio: (id, radio) => void (radio ? radios.set(id, radio) : radios.delete(id)),
      queueOf: () => [],
      refreshQueue: async () => [],
      credit: () => undefined,
      relabel: (_path, body) => body,
      request: async (method, path, body) => {
        seen.push(`${method} ${path} ${JSON.stringify(body ?? null)}`);
        return { status: 200, body: { ok: true, message: "done" } };
      },
    };
  }

  const post = (app: Awaited<ReturnType<typeof build>>, action: string, payload: object) =>
    app.inject({
      method: "POST",
      url: `/api/music-bot/player/b1/${action}`,
      headers: { "x-session-id": "s1" },
      payload,
    });

  it("puts FM in sequential mode and keeps it there until the queue is replaced", async () => {
    const seen: string[] = [];
    const bridge = radioBridge(seen);
    const app = await build({ id: "s1", music: bridge });

    expect((await post(app, "fm", { platform: "qq" })).statusCode).toBe(200);
    expect(seen).toEqual([
      'POST /api/player/b1/fm {"platform":"qq"}',
      'POST /api/player/b1/mode {"mode":"seq"}',
    ]);
    expect(bridge.radioOf("b1")).toBe("fm");

    const refused = await post(app, "mode", { mode: "random" });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({ error: "music.modeLocked" });
    expect(seen).toHaveLength(2);

    expect((await post(app, "clear", {})).statusCode).toBe(200);
    expect(bridge.radioOf("b1")).toBeNull();
    expect((await post(app, "mode", { mode: "random" })).statusCode).toBe(200);
    await app.close();
  });

  describe("requesters", () => {
    function creditBridge(queueAfter: MusicSong[]) {
      const credited: Array<{ songs: MusicSong[]; name: string; fromDiff: boolean }> = [];
      const owners: Array<string | undefined> = [];
      let refreshes = 0;
      const bridge: PooledBridge = {
        ...radioBridge([]),
        setRadio: (_id, _radio, owner) => void owners.push(owner),
        queueOf: () => [],
        // Fetched once before the call and once after it.
        refreshQueue: async () =>
          refreshes++ === 0 ? [{ id: "1", name: "old", platform: "qq" }] : queueAfter,
        credit: (_id, songs, name, fromDiff = false) =>
          void credited.push({ songs: [...songs], name, fromDiff }),
        relabel: (_path, body) => ({ relabelled: body }),
      };
      return { bridge, credited, owners };
    }

    it("credits a requested song to the TeamSpeak nickname", async () => {
      const { bridge, credited } = creditBridge([]);
      const app = await build({ id: "s1", music: bridge, tsSession: { selfNickname: "Alice" } });
      const song = { id: "9", name: "x", platform: "qq" };
      expect((await post(app, "add-song", { song })).statusCode).toBe(200);
      expect(credited).toEqual([{ songs: [song], name: "Alice", fromDiff: false }]);
      await app.close();
    });

    it("credits what a playlist added by comparing the queue, and names the FM owner", async () => {
      const added = { id: "2", name: "new", platform: "qq" };
      const { bridge, credited, owners } = creditBridge([
        { id: "1", name: "old", platform: "qq" },
        added,
      ]);
      const app = await build({ id: "s1", music: bridge, tsSession: { selfNickname: "Alice" } });
      await post(app, "fm", { platform: "qq" });
      expect(credited).toEqual([{ songs: [added], name: "Alice", fromDiff: true }]);
      expect(owners).toEqual(["Alice"]);
      await app.close();
    });

    it("relabels a queue answer on the way back", async () => {
      const { bridge } = creditBridge([]);
      const app = await build({ id: "s1", music: bridge, tsSession: { selfNickname: "Alice" } });
      const res = await app.inject({
        method: "GET",
        url: "/api/music-bot/player/b1/queue",
        headers: { "x-session-id": "s1" },
      });
      expect(res.json()).toEqual({ relabelled: { ok: true, message: "done" } });
      await app.close();
    });
  });
});
