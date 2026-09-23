# Next phase — whisper, server admin essentials, and streaming

> **Implemented** on branch `phase/whisper-admin-streaming` (`92a1f88..`,
> 2026-09-22), including the review fixes. What it left open is in
> `docs/m4-m5-remaining.md`; `docs/roadmap.md` §1 records what shipped. The
> plan below is kept as it was written — its §1 table predates the phase, and
> its claim that group-list refresh was already closed was not true until the
> phase fixed it.

Written against `integrate/m3` @ `b7c30ca`. It picks up where `docs/roadmap.md`
leaves off, and assumes the desktop-shell, viewer, video and PWA work of the
previous session, none of which the roadmap records yet.

## 1. Where the project actually stands

Checked against the code rather than the roadmap's own ticks.

| Milestone               | State                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0** 基础设施         | Done. `TsCmdRequestSchema` is the whitelist; the hub caches a `PermCatalog` with `groupEnds`, which M4's grouping needs and already has.                                                                                                                                                                                                       |
| **M1** 日常体验         | Done, bar the leftovers below.                                                                                                                                                                                                                                                                                                                 |
| **M2** 管理             | Done. Ban notices and group-list refresh are closed. Mobile still has no substitute for dragging a channel; error 2561 has no dedicated text.                                                                                                                                                                                                  |
| **M3** 文件传输         | Done, including stickers. Video is whole-file only (see item C); the file browser cannot move a file between channels; sticker packs cannot be reordered or copied between scopes.                                                                                                                                                             |
| **M4** 权限与服务器管理 | Untouched — but cheaper than the roadmap assumes, because `permissionlist`, `permoverview`, `clientpermlist`, `servergrouplist` and `channelgrouplist` are already whitelisted and cached. `privilegekey*`, `logview`, `serverrequestconnectioninfo` and `servergroupadd/del/rename/copy` appear nowhere; `serveredit` is explicitly rejected. |
| **M5** 语音进阶         | Untouched, but pre-wired: `HOTKEY_ACTIONS` reserves `"whisper"`, the i18n keys exist, and the hub already tracks `i_client_whisper_power`.                                                                                                                                                                                                     |
| **M6**                  | Untouched.                                                                                                                                                                                                                                                                                                                                     |
| **M7**                  | PWA install shipped; the app-icon badge did not. Document-PiP talk list not done.                                                                                                                                                                                                                                                              |
| **M8**                  | Emoji picker and image paste arrived via stickers and chat files. Reply/quote, Markdown, @mention, the 4-way PiP grid and a TS6 test run are not done.                                                                                                                                                                                         |

Open leftovers from M0/M1 worth naming:

- **No talk-power check.** Nothing in `audio/useVoice.ts` or `stores/voice.ts`
  stops a client without talk power from showing as speaking and uploading
  voice anyway.
- **The host banner still loads an external image directly.** The channel-tree
  banner was removed in `b7c30ca`, but `components/InfoPanel.vue` still renders
  `<img :src="s.hostbannerGfxUrl">` with no click-to-load gate.
- `.ini` identity import/export has never been round-tripped against a real
  TS3 desktop client.
- Auto-subscribe on joining a channel is stored per browser, not per identity.

## 2. The phase

Deliberately **not** "M4 in full". The five-way permission editor is the single
most expensive item on the roadmap and serves the fewest people; everything
else in M4 is small, independent, and unblocked.

| #   | Item                                                                              | Origin       | Size               |
| --- | --------------------------------------------------------------------------------- | ------------ | ------------------ |
| 0   | Split the i18n catalogues into per-feature partials                               | debt         | S                  |
| A   | Whisper: receive marker, send with whisper lists, hold-key                        | M5           | L                  |
| B   | Server admin essentials, minus the editor                                         | M4           | L (six S/M pieces) |
| C   | Range-capable media ticket; stream chat video                                     | M3 follow-up | M                  |
| D   | Talk-power gating; host-banner click-to-load; PWA unread badge; SW cache eviction | M1/M7        | S×4                |
| E   | Minimal ESLint flat config, warn-level                                            | debt         | S                  |

Deferred, with reasons: the permission editor (XL — propose as its own phase,
once B has built the `servergroup*` plumbing it needs); Speex/CELT (legacy
servers only); multi-server (XL, architectural); TS6 interop (research, no
code); a Document-PiP talk list (wants a design pass first); contacts (would
otherwise be next, but it touches `ChannelTree.vue` and `ChatPanel.vue`, which
item A already holds).

## 3. The items

### Item 0 — i18n partials (first, alone)

`i18n/zh-CN.ts` and `en.ts` are ~1,300 flat keys each and every lane needs to
add to both. They become `export const zhCN = { ...core, ...whisper, ... }`
with partials under `i18n/zh-CN/<feature>.ts`. `Messages` stays `typeof zhCN`
and `en` stays `: Messages`, so the both-catalogues typecheck survives; key
names do not change, so no call site moves. Create every planned partial as an
empty object up front, so no later lane edits the index.

### Item A — whisper

**A1, receive (S).** The client library routes packet type 0 (Voice) and type 1
(VoiceWhisper) into one `voiceData` event and discards the type, which is why
whispers already play, unmarked. A `patch-package` patch sets `whisper: t === 1`
on the payload. Add `VoiceFrameKind.DownWhisper` rather than a flags byte — it
keeps the header at six bytes and old decoders reject it cleanly. Then a second
speaking style in the tree, a `whisperReceived` cue, and a block/allow policy in
`stores/voice.ts`.

**A2, send (M–L).** No library fork needed: `client.handler.sendPacket` is on
the public type. The hub builds the whisper payload (id, codec, N channels, M
clients, opus) and validates every target against that session's own tree.
The web side switches the upstream frame kind while the whisper hold-action is
down, and a new settings pane edits the lists with the usual TS3 presets.

**Spike first, half a day:** confirm on a live server that a whisper packet sent
through the generic path is accepted — it may need the same signature handling
`sendVoicePacket` does, in which case the patch grows a `sendWhisperPacket`.

Risks: `patch-package` must be wired into the Docker build; cap N+M at 32 for
anti-flood; PTT/whisper key conflicts are already handled by `findConflicts`.

### Item B — server admin essentials

Each piece follows the established M2 shape: zod args in a **new**
`ts-commands-server.ts`, handlers appended to `gateway/commands.ts`, dialogs in
a **new** `components/server/`, entries in `useAdminMenus.ts`, gated by
`mayUse`.

- **B1 privilege key (S)** — `privilegekeyuse`, from the server menu and the
  connect dialog. Closes the spec the e2e README has been promising.
- **B2 group management (M)** — `servergroup*`/`channelgroup*` add, delete,
  rename, copy; sort id via the existing icon-perm allowlist, widened to
  `i_group_sort_id`, not opened into a general permission channel.
- **B3 virtual-server edit (M)** — `serveredit` with an enumerated field list:
  name, welcome and host messages, banner URLs, max clients, reserved slots,
  default groups, security level. Unknown keys stay refused.
- **B4 server log (M)** — paginated `logview`, parsed by a pure, tested module.
- **B5 connection info (S)** — `serverrequestconnectioninfo`, polled while the
  pane is open, through the paced command budget.
- **B6 permission overview (M)** — read-only, grouped by `groupEnds`. Answers
  "why does this client have this permission", and de-risks the future editor.

### Item C — range-capable media ticket

Streaming is impossible today for three separate reasons, all verified: the
download route never inspects `Range` and pipes through an `ExactLength` that
fails on the short read a range is; the ticket is single-use with a TTL under
ten seconds; and the bytes are served as an attachment with `nosniff`.
Underneath, TeamSpeak _can_ seek — `ftinitdownload` takes a `seekpos` the hub
hardcodes to `0`.

So: a **multi-use, session-scoped, revocable** ticket naming exactly one file,
with a ten-minute TTL and its own budget, and a route answering 206 with
`Content-Range`, no `Content-Disposition`, `nosniff` kept, and the MIME taken
from the _name_ against a video/audio allowlist — never from anything the
server declares, so an HTML file can never be served inline from the hub's
origin. Each request is one `ftinitdownload seekpos=a`. Keep the whole-file
path as a fallback when the hub does not advertise the feature.

### Item D — leftovers

- **D1 talk-power gating** — compute `canTalk` and gate transmission; show it
  in `VoiceControls.vue`. Touches `useVoice.ts`, so give it to the whisper lane
  or land it first.
- **D2 host-banner click-to-load** — reuse the `[IMG]` gate from `bbcode.ts`
  for the banner still rendered in `InfoPanel.vue`, remembered per server.
- **D3 PWA badge** — `navigator.setAppBadge` from existing unread counts.
- **D4 service-worker cache** — `public/sw.js` never evicts, and its
  `CACHE_VERSION` is bumped by hand, so every deploy adds a build's worth of
  hashed assets to the cache for good. Key the cache name on the build id and
  delete every other cache on `activate`: a few lines, and each redeploy then
  cleans up after the last one. Lives in lane 4, which owns `pwa/**`.

### Item E — ESLint

Root flat config, `typescript-eslint` + `eslint-plugin-vue`, `no-explicit-any`
at warn, a `lint` script, and **not** wired into `build` or `typecheck`. Clear
the vestigial `eslint-disable` comments only in files the phase already edits.

## 4. Parallel execution

Item 0 lands first and alone. D1 lands before or inside lane 1. Then:

| Lane    | Items     | Owns                                                                                                                                                                                                                                                                        |
| ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Voice | A, D1     | `protocol/voice-frame.ts`, `hub/gateway/TsSession.ts`, `hub/session/Session.ts`, `web/audio/**`, `stores/voice.ts`, `stores/hotkeys.ts`, `hotkeys/**`, `components/whisper/**`, `ChannelTree.vue`, `VoiceControls.vue`, `notify/events.ts`, `patches/`, `i18n/*/whisper.ts` |
| 2 Admin | B         | `protocol/ts-commands-server.ts` (new), `hub/gateway/commands.ts`, `components/server/**` (new), `useAdminMenus.ts`, `client-dialogs.ts`, `InfoPanel.vue`, `ConnectDialog.vue`, `i18n/*/server.ts`                                                                          |
| 3 Media | C         | `hub/files/**`, `protocol/files.ts`, `stores/transfers.ts`, `chat/files/**`, `components/viewer/**`, `i18n/*/media.ts`                                                                                                                                                      |
| 4 Small | D2, D3, E | `pwa/**`, `stores/clientPrefs.ts`, `eslint.config.js`, `i18n/*/misc.ts`                                                                                                                                                                                                     |

Rules that keep the lanes apart:

- After item 0, **nobody edits `zh-CN.ts` or `en.ts`** — only their own partial.
- `protocol/index.ts` is append-only; re-read immediately before editing.
- **No lane touches `App.vue` or `dock/useDesktop.ts`.** Whisper is a settings
  pane, admin dialogs use the existing host, the viewer host already exists.
  These two files were the contention points of the last session.
- `ChatPanel.vue` is untouched this phase, which is why contacts and mentions
  are not in it.
- Only one lane runs the e2e suite at a time, or each passes its own ports.

## 5. Debt

**Pay:** the media ticket (item C — cheap now, while the video code is fresh)
and a minimal ESLint (item E).

**Do not pay: jsdom.** The convention is deliberate — logic lives in pure
modules with node tests, DOM behaviour is covered by Playwright. Every item
above has a pure core that fits it: whisper target encoding, range→seekpos
arithmetic, log parsing, badge counting. Adding a DOM environment would invite
component tests that duplicate the e2e suite without a server behind them.
Revisit only for a phase dominated by pure UI, such as the permission editor.

**Not paying:** per-process limiters, SRV resolution, IPv6 — nobody has asked.

At phase end, update `docs/roadmap.md` §1 and the M3/M5/M7 rows (the previous
session's work is still missing from it) and write `docs/m4-m5-remaining.md`.

## 6. Verification

Unit, in the existing node environment: whisper frame kinds round-trip; the
whisper payload byte-exact against a fixture, with the N+M cap; `serveredit`
refusing unknown keys; media-ticket TTL, cap, revoke and mint-replaces; the
range route answering 206 with `Content-Range` and refusing a non-media name;
`ftinitdownload` carrying `seekpos`; the log parser; the badge count; the
talk-power gate as a pure function.

E2E, one new spec per lane, in the style of the `m2-*` specs: whisper with
three clients, asserting the third sees nothing; a guest redeeming the rig's
privilege key and gaining the admin group; a virtual-server rename seen by
another client; a video seeking and the hub logging a second `ftinitdownload`
with a non-zero `seekpos`.

Manual, because nothing else can: whisper audibility on real headsets, the PWA
badge, and the mobile layout of the new panes — copying the "no horizontal
scroll" assertion the admin dialogs already use.

## 7. Decisions needed before dispatch

1. Whisper library change by `patch-package` in-repo (recommended) or a
   vendored fork — and whether using the library's `@internal` `sendPacket` is
   acceptable.
2. Skip the permission editor this phase and take B6 as its seed — yes/no.
3. The `serveredit` field scope above, or fuller.
4. Media-ticket policy: TTL, opens per minute, one long-lived slot per open
   player, and the inline MIME allowlist limited to video and audio.
5. ESLint now, warn-level and non-blocking — yes/no.
6. The i18n split first — strongly recommended; without it four lanes collide
   on two 1,300-line files.
