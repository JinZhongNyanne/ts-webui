# Phase 2 (HTTP/WS surface) — what is still open

Phase 2 closed the openings that let an unrelated page, an unauthenticated
caller or a single client abuse the hub: origin checks on the websocket and on
every write, a session requirement on all `/api/*` routes, per-IP and
per-session ceilings, a guard against dialling private addresses, a path-safety
fix in the music proxy, response headers and log redaction. The items below are
known limits of that work.

## Closed since

Two of them have since been closed by Phase 3 and are recorded in
`docs/phase-3-remaining.md`:

- **The session id is still a bearer token in a URL** — asset URLs now carry a
  short-lived asset token minted over the websocket; fetch-based calls send the
  id in an `x-session-id` header.
- **DNS is resolved twice** — the guard's answer is now the address the driver
  dials, through a pinned resolver.

The sections below are kept as they were written.

## The session id is still a bearer token in a URL

Icons, avatars, profile assets and TTS audio are loaded by `<img>`/`<audio>`,
which cannot set a header, so the session id rides in the URL. The hub answers
with `Referrer-Policy: no-referrer` and redacts the id from request logs, but a
shared screenshot, a proxy log outside our control or a browser history export
still exposes it until the session ends.

A short-lived asset token (minted over the websocket, scoped to reads, valid
for minutes) would remove the last of it. That is a protocol change on both
sides, so it was left out of Phase 2.

## Nothing authenticates the hub itself

Anyone who can reach the hub can open a session and connect to any TeamSpeak
server the guard allows; the ceilings only bound how fast. A public deployment
that wants to be private still needs `HUB_ALLOWED_TS_SERVERS` plus an
authenticating proxy in front — the hub has no user accounts and Phase 2 did
not add any.

## The limits are per process

`RateLimiter` and `ConcurrencyLimiter` live in memory, so two hub instances
behind one proxy each grant a full budget, and a restart forgets everything.
That matches how the hub is deployed today (one container); a shared store
would be needed before scaling out.

## DNS is resolved twice

The outbound guard resolves the target and refuses private addresses, then the
TeamSpeak driver resolves the same name again for its socket. A name that
answers differently between those two lookups (DNS rebinding) is not covered.
Closing it means handing the driver a resolved address instead of a hostname,
which changes how `TsSession` opens its socket.

## What was verified

Against a running hub, with no TeamSpeak server involved:

- Security headers on API and HTML responses, and no HSTS outside production.
- `401` without a session on `/api/profiles`, `/api/profile/:asset`,
  `/api/tts/speak`; `403` on a write carrying a foreign `Origin`.
- The websocket refusing a foreign origin (close 4403) and the 11th session
  from one address (close 4429).
- A connect to `127.0.0.1` refused with `hub.connectBlockedTarget` under
  `NODE_ENV=production`, and accepted in development.
- The per-IP API limiter answering 429 after its budget, and the session id
  appearing as `***` in the request log.
- The built web UI loading and rendering under the app CSP with no violations.

Against a real TeamSpeak server and a live music bot, via
`scripts/verify-phase-2.mjs` — 19 checks, all passing:

```bash
node scripts/verify-phase-2.mjs --hub http://127.0.0.1:8080 --ts localhost:9987
```

(Since Phase 3 the script speaks the token/header shapes and takes
`--password` for a password-protected server; its latest run is recorded in
`docs/phase-3-remaining.md`.)

It connects a session and exercises the routes that need one: the profile
roster and upload (including `403` from a foreign origin, `415` on a type that
is not allowed, the bytes coming back with `nosniff`, and `401` for the same
URL without a session), `getClientInfo` over the websocket, `/api/tts/speak`,
and the music proxy — a whitelisted route answering 200 while
`POST /player/../fm` and `GET /users` are refused. It uploads a 1x1 PNG only
when the identity it connects with has no icon yet, and deletes it afterwards.

Two checks skipped on that run for want of material: the TeamSpeak icon route
(`/api/ts/<session>/icon/<id>`) needs a server with a downloadable icon, and
the avatar route needs a client that has uploaded one. Set either in a native
client and the script covers them.

## Still unverified

Nothing from Phase 2 is outstanding. The two Phase 1 items this section used to
flag — that a culled session's TeamSpeak client really disappears from the
server, and rejoining after a reconnect — have since been verified against a
real server by `scripts/verify-phase-1.mjs`. What is left there needs a browser
rather than a protocol client; see `docs/phase-1-remaining.md`.
