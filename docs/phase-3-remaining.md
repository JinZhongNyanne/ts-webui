# Phase 3 (asset tokens and DNS pinning) — what is still open

Phase 3 closed the two items `docs/phase-2-remaining.md` had left flagged: the
session id no longer rides in any URL, and the TeamSpeak driver dials the
address the outbound guard resolved rather than resolving the name a second
time. What that work left behind is recorded below.

## Closed since Phase 2

### The session id is out of every URL

`hello` now carries an `assetToken: { token, expiresAt }` next to the session
id. The token is 24 random bytes as base64url — always exactly 32 characters —
and is stateful: `AssetTokenStore` (in `session/asset-token.ts`) maps it to the
session id, and a route resolves it through
`registry.getConnectedByAssetToken()`, which applies the same "connected to a
server" rule as the session-id path. A token lives 15 minutes; the hub mints a
fresh one every 10 minutes (and on `assetToken.refresh`) and keeps up to four
live per session, evicting the oldest, so a rotation never breaks an `<img>`
that is still loading with the previous one. Ending the session revokes them
all at once.

The split follows what can set a header. Calls the page makes with `fetch()` —
the profile roster, the icon/sound upload and delete, the music proxy — send
the session id in `x-session-id` and never in a query string. Anything an
`<img>` or `<audio>` tag loads — `/api/ts/:token/icon/:id`,
`/api/ts/:token/avatar/:hash`, `/api/profile/:asset?token=`,
`/api/tts/speak?token=` — takes the asset token instead. A leaked asset URL now
reveals a read-only credential that expires on its own; a `?session=` in any of
those URLs is simply not looked at, so it answers `401` (or `404` on the icon
route, which gives a guesser nothing to distinguish).

On the web side `ts/asset-token.ts` keeps the token outside Vue's reactivity
and exposes only a boolean `hasAssetToken` ref, so a rotation does not rebuild
every image on the page.

### DNS is resolved once

`gateway/dial-target.ts` resolves the host once, checks _every_ answer against
the private-range guard (a name mixing a public and a private address can no
longer smuggle the private one through), picks the first IPv4 answer and hands
the driver a `pinnedResolver` that returns that address whatever it is asked.
The driver's own lookup chain never runs. The hub says so on the way in — a
`log` message with scope `connect` reading
`正在连接 host:port（已解析为 a.b.c.d）…` — which is what the verification
script asserts on.

## No compatibility window

The hub only understands the new shapes. A tab that was open across the deploy
still holds a session id and no token, so its icons and avatars break — and its
uploads answer `401` — until it reloads. The websocket reconnect brings a fresh
`hello` with a token, so the normal recovery is a page reload or the next
gateway drop, whichever comes first. Nothing was done to smooth this because
the sessions in question end with the hub restart anyway.

## The driver's SRV / TSDNS / myTeamSpeak resolution is bypassed

The `@honeybbq/teamspeak-client` driver would try a myTeamSpeak address, a
`_ts3._udp` SRV record and a TSDNS query before a plain A record. All of those
were exactly the guard bypass Phase 3 closed — the guard checked one answer and
the driver could dial another — so the pinned resolver skips them entirely, and
a server that is only reachable through an SRV record no longer connects.

Adding SRV back safely means doing the SRV lookup inside `resolveDialTarget()`
_before_ the guard, so the target the record points at is the one that gets
checked and pinned: query `_ts3._udp.<host>`, take the record's target and
port, resolve _that_ to addresses, run every answer through the private-range
check, and pin the result. TSDNS and myTeamSpeak would need the same treatment
and are not worth it until someone asks.

## IPv6-only targets fail

The driver opens a `udp4` socket, so `resolveDialTarget()` looks for an IPv4
answer and reports `hub.connectDnsFailed` when there is none. A name with only
an AAAA record therefore cannot be connected to. This was already the case
before Phase 3 (the driver's own lookup had the same limit) but it is now the
hub's message rather than an opaque dgram error. The fix is in the driver, not
here.

## The token store is per process

`AssetTokenStore` lives in memory next to the limiters. Two hub instances
behind one proxy would not honour each other's tokens, and a restart drops
every token — which is fine, since it drops every session too. A shared store
is needed before scaling out, the same as for `RateLimiter`.

## `HUB_SESSION_SECRET` is still unused

The config still reads it, but nothing signs anything with it: tokens are
random and looked up, not derived. It would matter for a stateless token
(HMAC over session id and expiry) that a second hub instance could verify
without a shared store. That design was passed over because a stateless token
cannot be revoked when the session ends, which is the property Phase 3 wanted.

## Browser cache keys per token

`/api/ts/:token/icon/:id` answers `cache-control: private, max-age=86400`, but
the token is part of the path, so a rotation makes every icon URL new and the
browser fetches them again from the hub's own cache. That is one round of
small requests every ten minutes per tab; the hub-side `asset-cache.ts` keeps
the bytes, so the TeamSpeak server is not asked twice. A `Vary`-free stable
URL would need the token in a header, which an `<img>` cannot send.

## Carried over from Phase 2

Neither of these was in scope and both remain as described in
`docs/phase-2-remaining.md`; they are the natural Phase 4 candidates:

- **Nothing authenticates the hub itself.** Anyone who can reach it can open a
  session; the asset token bounds what a leaked URL can do, not who can get
  one. A private deployment still wants `HUB_ALLOWED_TS_SERVERS` and an
  authenticating proxy in front.
- **The limits are per process**, and now the token store with them.

## What was verified

Against a real TeamSpeak server, via `scripts/verify-phase-3.mjs` — 20 checks,
all passing:

```bash
node scripts/verify-phase-3.mjs --hub http://127.0.0.1:8084 --ts ts.example.com:9987 \
  --password '<server password>'
```

It connects a session and checks:

- `hello.assetToken.token` matches `/^[A-Za-z0-9_-]{32}$/` and `expiresAt` is
  10–16 minutes ahead (it measured 15.0).
- The `connect`-scoped log line names an IPv4 address after `已解析为`; when
  `--ts` is `localhost`/`127.0.0.1` it must be `127.0.0.1`.
- `GET /api/ts/<token>/icon/<id>` answers 200 with bytes when the server has an
  icon (skipped otherwise, like the Phase 2 script), and the same path with the
  session id in place of the token answers 404.
- A profile icon reads back with `token=` (200, `nosniff`,
  `referrer-policy: no-referrer`) and is refused with `session=<id>` and no
  token (401). A 1x1 PNG is uploaded through the `x-session-id` header only
  when the identity has no icon, and deleted afterwards.
- `/api/tts/speak?text=hi&voice=en-US-AriaNeural&rate=+0%&token=` answers
  `audio/mpeg`; with `session=` and no token, 401. A 502/504 from the hub is
  reported as a skip ("no Edge access") rather than a failure.
- `/api/profiles` answers 200 with `x-session-id` and 401 with `?session=` and
  no header.
- `assetToken.refresh` answers `assetToken` with a different token; the old
  one still reads (grace) and the new one reads.
- After the websocket closes, both tokens answer 401 on a profile read and the
  icon route answers 404 for the newest one.

The Phase 2 script was updated to the new shapes and re-run with the same
flags — 20 checks, 18 passing and 2 skipped (no avatar on this identity; no
music bot reachable at the TeamSpeak host). Its "without a session" negatives
are now "with the session id where the token belongs" and still answer
401/404.

## Still unverified

- **Rotation on the timer.** The script forces a rotation with
  `assetToken.refresh`; the 10-minute interval itself is covered by the unit
  tests with a fake clock, not end to end.
- **The eviction cap.** Minting a fifth token drops the first; asserted in
  `asset-token.test.ts`, not against a live hub.
- **A browser across a rotation.** That an `<img>` mid-load with the old token
  still completes, and that the page does not re-render every icon, needs a
  browser run; the protocol script cannot see either.

## Noted in review, left as is

A review of the merged branch flagged these; each is real but small enough
to carry rather than block on.

- The music-bot bridge pool is capped at 32 distinct bots per hub process;
  the 33rd session naming a new bot gets `hub.musicUnreachable` until one is
  released. Sessions naming an already pooled bot are unaffected.
- `AssetTokenStore.mint()` rebuilds its map on every call, so a client that
  hammers `assetToken.refresh` costs O(live tokens) per call. The per-session
  command limiter bounds it; a per-session index would remove it.
- `isPrivateAddress()` recognises the dotted IPv4-mapped IPv6 form
  (`::ffff:10.0.0.1`) but not the hex form (`::ffff:a00:1`). The TeamSpeak dial
  never sees it (IPv4 only); the music guard could, once a bot host answers
  AAAA records that way.
- The music guard now pins the resolved address into the bridge's dialer
  (HTTP and websocket) and refuses redirects, closing the same rebinding hole
  the TeamSpeak dial closed; the operator's own `MUSICBOT_URL` is exempt from
  the private-range rule, and the "same host as the TeamSpeak server"
  exemption applies only on the bot's default port.
