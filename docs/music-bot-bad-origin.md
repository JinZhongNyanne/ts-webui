# Music bot "bad origin" fix — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every proxied play/pause/seek/add/remove call to teamspeak-music-bot
succeeds instead of failing with `403 {"error":"bad origin"}`.

**Architecture:** The hub's `BotBridge` is a server-side client of the bot's
REST API. The bot guards every non-safe method under `/api` with a same-origin
CSRF check, so the bridge must present an `Origin` header whose host equals the
bot's own host on every REST call, exactly as it already does on the websocket
handshake. The fix is confined to `BotBridge` plus a new unit test file.

**Tech Stack:** Node 22 `fetch`, `ws`, vitest 5 (`apps/hub`, run with
`npm test -w apps/hub`).

**Spec:** this document (the "Root cause" section below is the spec).

## Global Constraints

- No new dependencies.
- Immutable style: build new header objects; never mutate a shared one.
- Keep the change to the root cause: no refactor of `BotBridge` beyond what the
  header needs. No "while I'm here" edits.
- Commit message format `<type>: <description>`; end the body with
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## Root cause

**Symptom.** In the music panel, searches and the queue load fine, but any
control (play, pause, next, seek, volume, add song, remove from queue) fails and
the UI shows the error text `bad origin`.

**Where the string comes from.** It is not in this repo. It is produced by the
bot, in `src/web/middleware/csrf.ts` of
[teamspeak-music-bot](https://github.com/ZHANGTIANYAO1/teamspeak-music-bot)
(added upstream in commit `d1c9e14b`, 2026-05-27, "feat(auth): add
csrfOriginCheck middleware"):

```ts
// bot: src/web/middleware/csrf.ts
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export function csrfOriginCheck(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const expectedHost = req.get("host");
  const headerHost = hostOf(req.get("origin")) ?? hostOf(req.get("referer"));
  if (!headerHost || !expectedHost || headerHost !== expectedHost) {
    res.status(403).json({ error: "bad origin" });
    return;
  }
  next();
}
```

It is mounted in the bot's `src/web/server.ts` as `app.use("/api",
csrfOriginCheck)` **after** the `/api/session` router. That ordering explains
the exact shape of the symptom:

| Hub call                                  | Bot path            | Method | Passes the gate? |
| ----------------------------------------- | ------------------- | ------ | ---------------- |
| `login()` (`/api/session/login`, `guest`) | mounted before gate | POST   | yes              |
| search / queue / providers / bot list     | under gate          | GET    | yes (safe)       |
| play, pause, seek, volume, add-song, …    | under gate          | POST   | **no → 403**     |
| remove from queue                         | under gate          | DELETE | **no → 403**     |

**Why the hub trips it.** `BotBridge.request()` in
`apps/hub/src/musicbot/BotBridge.ts` sends only `cookie`, `accept` and
`content-type`. Node's `fetch` never adds `Origin` or `Referer` on its own, so
`hostOf(...)` is `null` on the bot side and the gate rejects. The websocket
path in `connectWs()` already sends `origin: this.baseUrl`, which is why the
stream works and why the REST omission went unnoticed.

**Why the fix is on the hub side.** The hub is a trusted server-side client,
and the bot's check is a legitimate CSRF defence for its own browser UI. The
hub simply needs to identify itself the way a same-origin browser would: an
`Origin` whose host matches the URL it is calling. `MUSICBOT_URL` already
holds that origin. The bot's `hostOf` compares `new URL(x).host`, so the value
must be a URL whose host (including port) equals the request's `Host` header,
which `fetch` derives from the same `MUSICBOT_URL`. They always agree.

**What is not the cause.** Not the hub's own origin policy in
`apps/hub/src/security/origin.ts` (that is checked by the hub on the
browser's requests and returns `forbidden origin`, a different string), not
the route allow list (a blocked route answers `route not allowed`), and not the
session cookie (a stale cookie answers 401 and is already retried).

## File structure

- Modify: `apps/hub/src/musicbot/BotBridge.ts` — derive the bot origin once in
  the constructor, send it as `Origin` on `login()` and `request()`, and reuse
  it for the websocket handshake.
- Create: `apps/hub/src/musicbot/BotBridge.test.ts` — unit tests that stub
  global `fetch` and assert the header on each outgoing request.

---

### Task 1: Send the bot's origin on every REST call from `BotBridge`

**Files:**

- Modify: `apps/hub/src/musicbot/BotBridge.ts` (constructor ~line 50,
  `login()` ~line 103, `request()` ~line 130, `connectWs()` ~line 229)
- Create: `apps/hub/src/musicbot/BotBridge.test.ts`

**Interfaces:**

- Consumes: `BotBridge` constructor `BotBridgeOptions { baseUrl, username,
password, logger, insecureTls? }` and the public
  `request(method, path, body?, retry?)`; unchanged.
- Produces: no new public API. New private readonly field `origin: string`.

- [x] **Step 1: Write the failing test**

Create `apps/hub/src/musicbot/BotBridge.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { BotBridge } from "./BotBridge.js";
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
}

/** Stubs global fetch; every call logs in fine and answers `{ ok: true }`. */
function stubFetch(): Seen[] {
  const seen: Seen[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      seen.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers) });
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
    // Login is also a POST and is recorded first, so select by path.
    const post = seen.find((s) => s.method === "POST" && s.url.endsWith("/next"));
    expect(post?.url).toBe("http://host.local:8080/musicbot/api/player/b1/next");
    expect(post?.headers.get("origin")).toBe("http://host.local:8080");
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test -w apps/hub -- BotBridge
```

Expected: all three tests FAIL with `expected null to be 'http://…'` (no
`origin` header is sent today).

- [x] **Step 3: Implement the minimal change in `BotBridge.ts`**

Add the field next to `baseUrl`:

```ts
  private readonly baseUrl: string;
  /**
   * Scheme + host(:port) of the bot, sent as `Origin` on every call. The bot's
   * `/api` CSRF gate refuses any POST/DELETE whose Origin (or Referer) host does
   * not equal its own Host header, answering `403 {"error":"bad origin"}`.
   * Node's fetch never adds Origin by itself, so we must.
   */
  private readonly origin: string;
```

Set it in the constructor after `this.baseUrl`:

```ts
this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
this.origin = originOf(this.baseUrl);
```

Add a module-level helper (below the interfaces, above the class):

```ts
/** `http://host:port` of a base URL; the URL itself when it does not parse. */
function originOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}
```

In `login()`, add the header:

```ts
      headers: { "content-type": "application/json", origin: this.origin },
```

In `request()`, add the header to the built object:

```ts
      headers: {
        cookie: this.cookie,
        accept: "application/json",
        origin: this.origin,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
```

In `connectWs()`, reuse it so the two paths cannot drift apart:

```ts
      headers: { cookie: this.cookie, origin: this.origin },
```

- [x] **Step 4: Run the tests to verify they pass, and the rest still does**

Run:

```bash
npm test -w apps/hub
```

Expected: the three new tests PASS; every previously passing test still
passes.

Then:

```bash
npm run typecheck -w apps/hub
```

Expected: no errors.

- [x] **Step 5: Commit**

```bash
git add apps/hub/src/musicbot/BotBridge.ts apps/hub/src/musicbot/BotBridge.test.ts
git commit -m "fix: send the bot's origin on proxied music-bot REST calls

teamspeak-music-bot guards every non-GET route under /api with a
same-origin CSRF check and answers 403 {\"error\":\"bad origin\"} when the
Origin/Referer host does not match its own Host. BotBridge.request() sent
neither, so every play/pause/seek/add/remove through the hub failed while
login and reads kept working. Send the bot's origin on REST calls the way
the websocket handshake already did.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Verification against a real bot

Not automatable here, but the one manual check that proves the fix end to end:

1. Start the stack with `MUSICBOT_URL` pointing at a bot on upstream commit
   `2ea02f54` or newer.
2. Connect to a TeamSpeak server, open the music panel, search, then press
   play or pause on a song.
3. Expected: the control takes effect and no `bad origin` toast appears. Hub
   logs show no `music bot proxy failed` line for the call.

## Out of scope (deliberately)

- Making the origin configurable separately from `MUSICBOT_URL`. Only a bot
  behind a Host-rewriting reverse proxy would need it; there is no such
  deployment in `deploy/`, and `fetch` derives `Host` from the same URL, so
  the two always agree today.
- Mapping the bot's `bad origin` text to a friendlier message in the web
  client. Once the header is sent, the bot never returns it to us.
