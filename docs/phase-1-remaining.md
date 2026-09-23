# Phase 1 (resilience) — what is still open

Phase 1 landed the hub heartbeat, the browser keepalive/latency readout, the
auto-reconnecting gateway link and the connection banner (commit "Phase 1:
heartbeat, keepalive and auto-reconnect"). A follow-up closed the three
functional gaps that work had left behind; what is left is recorded below.

## Closed since

### Reconnect returns you to the channel you were in

`stores/ts.ts` now snapshots the live channel — its `client_default_channel`
path and the password it was joined with — at the moment the link drops, before
`resetServerState()` clears the tree that the path is built from. The replayed
connect is assembled by `buildReplayRequest()` in `ts/reconnect.ts`, which
prefers that snapshot and falls back to the profile's configured default.

Channel names are unique server-wide on TeamSpeak (a duplicate is refused with
error 771), so a name path identifies a channel exactly. A `/` inside a name is
escaped as `\/`, which is required: the server reads an unescaped one as a path
separator. All of this is covered by `scripts/verify-phase-1.mjs`.

### Video and screen share resume after a reconnect

`RtcRoom` gained `detachLocalMedia()`, which hands the local captures back with
their tracks still live — the one way out of a room that does not stop them,
where both `setScreen(false)` and `close()` deliberately do. `stores/rtc.ts`
uses it to park the screen capture across a drop and re-publishes it from
`join()`, so the rejoin that the channel watcher already drives stays the only
thing that brings a room back.

A camera is _not_ replayed: coming back with the lens live is not obviously
wanted, so the banner offers "Turn camera back on" instead. A screen share whose
capture the user stopped at the OS level while offline is detected via
`readyState` and reported rather than silently dropped.

### A TeamSpeak-side drop auto-retries before falling back to the banner

`RetryScheduler` (in `ts/reconnect.ts`) gives a non-user drop three attempts on
a jittered 2s/4s/8s ladder, after which the banner's Reconnect button takes
over as before. The budget is reset by a successful snapshot and cancelled by a
user disconnect or a fatal error. A _gateway_ drop is untouched: the connection
layer still redials on its own, and the scheduler stands down so it does not
burn its budget against a dead socket.

## Verified against a real server

`scripts/verify-phase-1.mjs` — 10 checks, all passing against a TeamSpeak
3.13 server in Docker:

```bash
node scripts/verify-phase-1.mjs --hub http://127.0.0.1:8080 --ts localhost:9987 \
  --query-pass '<serveradmin password>'
```

It makes its own scratch channels over ServerQuery (and removes them again),
then checks that a replayed connect lands in the live channel, in a nested one,
and in one whose name contains a slash — plus that the _unescaped_ path does
not, so the escaping is not cargo cult. It also confirms the server accepts a
`/<cid>` form, which the client does not use: the name path is the documented,
portable one and is equally precise given server-wide unique names.

The heartbeat is exercised end to end with a socket opened with
`autoPong: false`, imitating a frozen tab, and a second session watching the
client list. **The culled session's TeamSpeak client really does disappear from
the server** — the item both phase docs had flagged as the important unknown.

### Running a test server

```bash
docker run -d --name ts3-test -e TS3SERVER_LICENSE=accept \
  -p 9987:9987/udp -p 10011:10011 -p 30033:30033 teamspeak
```

The `serveradmin` password and the admin token are in the container's first-boot
log. Two things the verification script needs from a fresh container:

- ServerQuery only answers loopback by default, and Docker NAT is not loopback.
  Append `0.0.0.0/0` to `/var/ts3server/query_ip_allowlist.txt` and restart.
- Repeated connect/disconnect trips anti-flood and the hub then reports
  `hub.tsBanned`. Raise the thresholds
  (`serveredit virtualserver_antiflood_points_needed_ip_block=500000
virtualserver_antiflood_points_needed_command_block=500000
virtualserver_antiflood_points_tick_reduce=500000`) and `bandelall`. Note that
  setting these to `0` blocks _instantly_ rather than disabling the check.

## Verified in a real browser

`scripts/verify-phase-1-browser.mjs` — 15 checks, all passing on **both**
backends. Chromium runs headed with fake media devices and an auto-selected
capture source, so nothing needs a human at the keyboard:

```bash
# apps/web dev server (the __jinzTs / __jinzRtc hooks exist only in dev builds)
VITE_HUB_URL=http://127.0.0.1:8080 npx vite --port 5273

node scripts/verify-phase-1-browser.mjs --url http://127.0.0.1:5273 \
  --ts localhost:9987 --query-pass '<serveradmin password>' \
  --ts-container ts3-test --backend mesh
```

Bouncing the TeamSpeak container is what produces a real, non-fatal,
not-the-user's-doing drop. Across it the script checks that the banner counts
the retry attempts, the session returns, the screen share is publishing again,
the microphone is back, and the camera is offered rather than re-enabled — then
clicks the real banner button and watches the camera come on.

The strongest of these is the getDisplayMedia call count: it is **1 before the
drop and 1 after**, which is the direct proof that the resumed share reuses the
capture it already had instead of quietly asking for a new one. Run with
`--backend livekit` against a LiveKit-configured hub, it covers
`LiveKitRoom.detachLocalMedia()` and its `unpublishTrack(track, false)` the same
way.

### Two bugs this caught

Both were invisible to the unit tests and to the protocol-level script, because
both live in watcher ordering:

- **The room was torn down before its captures could be parked.** A session on
  its way out drops our own client first, so the `selfChannel` watcher saw
  `undefined` — while `connState` was still `"connected"` — and closed the room,
  stopping the very tracks the connState watcher was about to rescue. Losing
  your channel is not a channel _switch_, so that watcher now ignores an empty
  id and leaves teardown to the connState one.
- **`hadCamera` was always false.** `detachLocalMedia()` reports a change, and
  the `sync()` behind it zeroes `cameraOn`/`screenOn` — so reading the flags
  after the call read them after they had already been cleared. They are now
  read first.

### A kick is deliberately not retried

`TsSession` reports an admin kick as a fatal error, which clears
`wantConnected` and cancels the ladder: reconnecting into a server that just
kicked you is bad manners and a good way to get banned. The banner offers the
button instead. This is asserted, so it cannot regress silently.

## Still unverified

- **Audio that a person would call correct.** The fake device makes a
  deterministic tone, so the checks prove the mic is enabled and the pipeline
  carries it — not that a human would be happy with how it sounds.

- **The real screen picker.** `--auto-select-desktop-capture-source` bypasses
  the chooser, so the code path is covered but the human picking a window is
  not. Same for `--use-fake-ui-for-media-stream` and the permission prompt.

- **The video panel's own buttons.** The tests drive `shareScreen()` /
  `toggleCamera()` through the dev-only `__jinzRtc` hook rather than clicking
  inside the dock, so the one-line `@click` bindings in `VideoPanel.vue` are
  not exercised. The camera-resume button _is_ a real click, because the banner
  lives in the app shell.

- **A gateway drop, as opposed to a TeamSpeak-side one.** The browser suite
  drops the TeamSpeak server; the hub link itself going down is covered by the
  protocol script instead. Chromium's `setOffline` does not close an already
  open websocket, so simulating it in-page would need the hub restarted
  mid-test.

## Log noise on reconnect (fixed)

The browser tears its video room down while the session is going away, so its
`rtc.leave` / `rtc.publishing` raced the disconnect and the hub answered
`not_connected` — two red lines in the user's log on every reconnect. Those two
messages are session-scoped bookkeeping that never needed the TeamSpeak link
(and `rooms.leave()` already runs server-side when a session ends), so the hub
now handles them before the link guard and they are accepted either way. A
command that genuinely needs the session, such as `moveTo`, still says
`not_connected`.

Covered by `ws-smoke.test.ts` and asserted end to end by the browser suite,
which now fails if a reconnect leaves any `not_connected` in the log.
