# M4/M5 phase (whisper, server admin, streaming) — what is still open

This phase implemented `docs/next-phase-plan.md` on branch
`phase/whisper-admin-streaming` (`92a1f88..`): the i18n split into per-feature
partials; whisper send and receive with talk-power gating (M5); the server
admin essentials — privilege keys, server and channel group management, a
trimmed `serveredit`, the server log, connection info, a read-only permission
overview, and a click-to-load gate for the host banner (M4 minus the
permission editor); range-capable media links so chat video streams (the M3
follow-up); a PWA unread badge, service-worker cache eviction and a warn-level
ESLint config; and the fixes a code review of all of it asked for.
`docs/roadmap.md` §1 and the M3/M4/M5/M7/M8 rows now record what shipped. What
the phase left behind is below.

## Deferred by decision

### The permission editor

The five-way editor (`servergroupperms`, `channelgroupperms`, `channelperms`,
`clientperms`, `channelclientperms` and their add/del) was deliberately kept
out: it is the most expensive item on the roadmap (XL) and serves the fewest
people. It is proposed as its own phase. What this phase built for it:

- the `servergroup*` / `channelgroup*` plumbing and dialogs
  (`components/server/GroupsDialog.vue`);
- `components/server/perm-overview.ts` — the catalogue parser, grouping by the
  server's `groupEnds`, and a resolver — which the editor is meant to reuse;
- the narrow icon-permission allowlist (`protocol/ts-icon-commands.ts`), now
  opening `i_icon_id`, `i_group_sort_id` and `i_group_show_name_in_tree` and
  nothing else. The editor needs a general permission channel instead, with
  its own review of what a page may set.

The plan's note on debt still applies: that phase is the one where a DOM test
environment might finally earn its place.

### `serveredit` covers fourteen fields

Name, welcome message, host message and its mode, the banner's and host
button's link and image, max clients, reserved slots, the default server and
channel groups, the needed security level and the forced-silence threshold
(`protocol/ts-commands-server.ts`). Passwords, ports, anti-flood and the
transfer quotas the roadmap row also names are left to the native client, and
any other key is refused. The host button tooltip, banner mode and banner
refresh interval are not offered either.

### Groups

Only regular groups are created (`type=1`); template and query groups belong
to the instance administrator. Copy always makes a new group — copying onto an
existing one is not offered. (Assigning a group the client already has, error
2561, was given its own text on `fix/m2-leftovers`, now in `main`.)

## Whisper

### Whisper power is visible only when the server reports zero

The server lets a whisper through to a listener only when the whisperer's
`i_client_whisper_power` is at least that listener's
`i_client_needed_whisper_power`, and drops the rest silently — nobody hears
anything back. The page can see its own power (when the hub has
`b_client_permissionoverview_own`), but never the listeners' needed power, so
the only honest hint is the case the server spells out: our power is 0
(`components/whisper/whisper-power.ts`). The hint says "may", and the key is
never blocked.

The cost: on a default TS3 server a normal user's whisper power is reported
as 0, yet nobody's needed whisper power is set either, so their whispers do
arrive — and they still see the warning next to the whisper pill and in the
pane. A better answer needs the listeners' needed powers, which sit behind
`b_client_permissionoverview_view`.

### One list, classic targets only

- There is one whisper list, not TS3's several lists on several keys.
- Targets are the classic header only — N channels and M clients. The presets
  (channel, parent, all parents, subchannels, the channel and everything below
  it, all channels, channel commanders) are expanded into ids on the page.
  TS3's "new format" group targets (a server group, a channel group, the
  server's target modes) are not implemented, so there is no "whisper to a
  server group" entry.
- The hub keeps at most 32 targets. "All channels" on a server with more than
  32 channels is truncated; the pane and the whisper pill both say so, but the
  rest are simply not reached.
- The receive policy is "allow" or "block". "Friends only", which the roadmap
  row asks for, waits for contacts (M6).

### Phones cannot whisper

The whisper key is a hold-hotkey, and the hotkeys tab is desktop-only. A phone
has no on-screen whisper button, so it can receive whispers and edit a list in
the settings pane but never send. Like push-to-talk, the key on the desktop
also works only while the page has focus (M7).

### Talk power removed while a soundboard clip is playing

`soundboard/rules.ts` refuses to start a clip without talk power, and says so.
A clip that is already playing when talk power is taken away keeps playing
locally: the gate (`audio/gate.ts`) closes the channel route at once, so
nothing more is sent, but the board does not stop the clip or say anything.
The user hears the rest of it and may believe the room did too.

### `setCodec`'s rebuild failure is not observed

`VoiceEngine.setCodec` calls `void this.rebuildEncoder()`. The rebuild closes
the old encoder first and then awaits `createOpusEncoder`; if that rejects,
the rejection goes nowhere — no `onError`, no log line — and the engine is
left with no encoder, so it silently sends nothing until the next codec or
quality change or a restart of the send path. `latest-build.ts` swallows only
the failures of _superseded_ builds; a current build's failure should reach
`cb.onError` the way an encode error already does.

## Permission overview

`resolvePermission` is a simplification of TeamSpeak's evaluation, which is
why the window is read-only and says the server's answer is the one that
counts:

- `skip` is treated as set when _any_ server group carries it, or the client
  permission does — not only the group whose value won. Whether TeamSpeak
  combines `skip` across groups exactly that way has not been checked against
  a live server.
- Negation among server groups is "lowest of the negated values wins"; group
  weights and grant powers are not modelled.
- What `skip` keeps out follows the server's own `permissiondoc.txt`: the
  channel and the channel group, but not the client's own permission in that
  channel. The first version also shut that one out; the rule was corrected
  against the document read from the running test server.

## Media links

### Chromium cuts its own first stream once

A media link runs one stream at a time: a new request on the link takes over
the transfer slot and cuts the stream still running (`claim` in
`files/media-routes.ts`). Chromium, opening a WebM, asks for the file's tail
(to find the cues) while its first range is still open, so the tail request
cuts the player's own first stream once. It has been harmless so far —
playback starts and seeks normally — but it is the hub cutting a stream the
player still wanted, and a stricter player could treat that as an error.
Letting a link hold two streams, or not cutting a stream whose range the new
request does not overlap, would remove it at the price of a second transfer
slot.

### Budget

Every open spends one of the session's media opens
(`HUB_FT_MEDIA_OPENS_PER_MIN`, 12 by default) and, on top of that, one of the
ordinary transfer inits (`HUB_FT_RATE_PER_MIN`, per session, user and
address). Opening a clip spends a large share of a minute's media opens in
practice (the player reads the container's index more than once), so frantic
scrubbing can hit a brief `ft.rateLimited`, and a long scrubbing session eats
into the same budget downloads and uploads use. A refused seek leaves the running stream
playing. When the hub does not advertise media links the page falls back to
the whole-file fetch, capped at 32 MiB.

### Audio has no player

The hub's allowlist accepts audio (mp3, m4a, aac, oga, ogg, opus, weba, wav, flac) as
well as video, but the page only builds a player for mp4, m4v, webm and ogv
(`chat/files/naming.ts`). Audio files, and `.mkv`/`.mov`/`.avi`, stay plain
download cards. The file browser opens neither pictures nor videos in the
viewer.

## Tooling and tests

### `desktop-tab-state` is flaky

`scripts/e2e/specs/desktop-tab-state.spec.mjs` fails intermittently, and fails
on the phase's base commit too, so it is not a regression of this phase. It
has not been diagnosed.

### ESLint is advisory

`npm run lint` is warn-level and not part of `build`, `typecheck` or CI. It
currently reports about thirty warnings and no errors. Promoting rules to
errors, and wiring it into CI, is a later decision.

### PWA icons are placeholders

The installed app's icon is a monogram on the accent gradient;
`scripts/pwa/rasterise-icons.mjs` regenerates the PNGs from the SVGs.

## Closed during the phase

Recorded so they are not reopened by mistake:

- **Whisper picks followed channel ids across servers.** Hand-picked channels
  are now filed per server (`whisper-saved.ts`); older picks with no server
  are dropped rather than guessed at.
- **The chat poster and the player fought over one link.** The poster copies
  its first frame into a `data:` URL and lets go of the stream before the
  player may open; a closed player lets go of its link.
- **Transfer slots leaking on an early close.** The download route and the
  media route both attach their close listener before any await, and a
  connection that closed before the handler ran is caught as well
  (`files/on-gone.ts`); a slot comes back exactly once.
- **Deleted groups lingering until a reconnect**, and **granted powers
  reaching the page only after a reconnect** — group lists are now replaced
  whole, and the hub re-reads its own powers when it joins or leaves a group.
- **Raced encoder rebuilds** — builds carry a generation and a stale one is
  closed on arrival (`audio/latest-build.ts`).

## Still to verify by hand

Nothing automated covers these:

- **Whisper audibility on real headsets** — the e2e spec asserts frames reach
  the right clients, not that a person hears them cleanly, and that the tail
  of a whisper never leaks into the channel.
- **The PWA badge on an installed app** — Chrome/Edge on desktop and Android;
  the badge should appear while the app is in the background and clear on
  return.
- **The host banner and chat images under the production CSP** — the vite dev
  server and the e2e rig send no CSP at all, so only a hub-served build shows
  whether `img-src` lets a consented external image load.
- **The picture viewer and video player on a real phone** — pinch, double tap,
  the transport bar and the notch insets were measured in an emulated
  390×844 viewport, not on a device.
- **The new admin dialogs on a real phone** — the e2e spec only asserts they
  do not scroll sideways at phone width.
