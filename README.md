# JinzTS — TeamSpeak in the browser

[![docker](https://github.com/JinZhongNyanne/ts-webui/actions/workflows/docker.yml/badge.svg)](https://github.com/JinZhongNyanne/ts-webui/actions/workflows/docker.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)

**[简体中文](README.zh-CN.md)**

A full TeamSpeak 3 client that runs in a browser tab — voice, the channel tree,
chat, file transfers, moderation and server admin — plus things a native client
never had: camera and screen sharing between web users, a shared soundboard,
stickers, TTS announcements, and a song-request panel driven by
[teamspeak-music-bot](https://github.com/ZHANGTIANYAO1/teamspeak-music-bot).

Nothing is installed. You give people a URL and a password; they type a nickname
and they are in the channel.

```
browser (Vue 3)  ⇄ WebSocket ⇄  hub (Node)  ⇄ UDP ⇄  TeamSpeak 3 server
                                   │  ├─ proxies the music bot's REST/WS
                                   │  └─ mints LiveKit tokens
                                   └───── WebRTC ──── LiveKit (video / screen share)
```

The **hub** is the only thing exposed to the internet. Browsers cannot speak UDP,
so every browser session is backed by a real TeamSpeak client living inside the
hub, with its own identity and nickname — to everyone else on the server, a web
user is just another user.

---

## Features

| Area                   | What you get                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Voice**              | Opus encode/decode in the browser via WebCodecs, per-user volume (0–200%), auto-levelling, an output limiter ("ear guard"), hotkeys, talk power, whisper                |
| **Channels & chat**    | Full channel tree with spacers and subscriptions, complete TeamSpeak BBCode, click-to-load remote images, local chat history in IndexedDB, host messages                |
| **Files**              | Channel file browser, streaming upload/download through the hub, `ts3file://` links in chat, inline image/video/audio previews with seeking                             |
| **Moderation & admin** | Kick, move, ban (with a ban list), complaints, offline messages, the client database, temporary passwords, server groups, privilege keys, server settings and log       |
| **Video**              | Camera and screen share between web users — peer-to-peer mesh by default, LiveKit SFU for bigger rooms                                                                  |
| **Music**              | Song requests, queue, lyrics, per-platform discovery tabs, playback history, guest mode                                                                                 |
| **Personalisation**    | Avatars and icons, per-user channel-entry sounds, a shared soundboard, stickers, themes with gradients and frosted glass, custom CSS                                    |
| **Shell**              | A Windows-style desktop: floating windows, tabs you can tear out, Aero Snap, Snap Layouts, a taskbar and wallpaper — and a dedicated mobile layout below the breakpoint |
| **Platform**           | Installable as a PWA, desktop notifications, TTS announcements, English and Simplified Chinese UI                                                                       |

---

## Quick start

### Run the published image

Everything is one container: the hub serves the built web UI itself, so there is
no separate frontend service. You need Docker and a TeamSpeak 3 server.

```bash
git clone https://github.com/JinZhongNyanne/ts-webui.git
cd ts-webui/deploy
cp .env.example .env     # at minimum: HUB_PUBLIC_ORIGIN, HUB_SESSION_SECRET, DOMAIN
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

That brings up the hub, LiveKit, and Caddy for HTTPS. Upgrading is another pull:

```bash
docker compose -f docker-compose.ghcr.yml pull hub
docker compose -f docker-compose.ghcr.yml up -d hub
```

Images are published to GHCR by [`.github/workflows/docker.yml`](.github/workflows/docker.yml):
every commit on `main` becomes `latest` and `sha-<short>`, and a `v*` tag also
gets `1.2.3` and `1.2`. Choose a version with `HUB_IMAGE` / `HUB_TAG` in `.env` —
pin a tag on a server you do not want moving under you.

To build from source on the server instead: `docker compose up -d --build`.

### Already have a reverse proxy?

If you terminate TLS elsewhere (a NAS, Zoraxy, nginx, Synology…) you do not need
the bundled Caddy — the whole thing is a single container. Publish its port 8080
and proxy to it:

```yaml
services:
  ts-webui:
    image: ghcr.io/jinzhongnyanne/ts-webui-hub:latest
    container_name: ts-webui
    restart: unless-stopped
    ports:
      - "5173:8080"
    environment:
      HUB_HOST: "0.0.0.0"
      HUB_PORT: "8080"
      HUB_PUBLIC_ORIGIN: "https://ts.example.com:8443"
      HUB_ALLOWED_ORIGINS: "http://<lan address of this host>:5173"
      HUB_SESSION_SECRET: "<openssl rand -hex 32>"
      HUB_TRUST_PROXY: "1"
      HUB_PASSWORD: "<gateway password for your users>"
      HUB_TS_SERVER: "<teamspeak host>:9987"
      HUB_TS_PASSWORD: "<server password, or empty>"
      MUSICBOT_URL: "https://bot.example.com:8443"
      MUSICBOT_INSECURE_TLS: "1"
      HUB_DATA_DIR: "/app/data"
    volumes:
      - <host path>/ts-webui/data:/app/data
```

Your reverse proxy **must** forward `Upgrade` / `Connection` headers and speak
HTTP/1.1 upstream — HTTP/2 cannot upgrade a WebSocket.

---

## Local development

Requires Node ≥ 22 and Docker (for a throwaway TS3 server and LiveKit).

```bash
npm install
cp deploy/.env.example .env              # note: in the repo root
docker compose -f deploy/docker-compose.dev.yml up -d
npm run dev                              # protocol (tsc -w) + hub + web, together
```

Open <http://localhost:5173> and connect to `localhost:9987`. The `serveradmin`
password is printed once, on the TS3 container's first boot — `docker logs jinz-ts3`.

The hub only reads a `.env` from the **repo root** or its working directory (see
`apps/hub/src/index.ts`). `deploy/.env` is read by `docker compose` alone; a dev
hub will not pick it up.

### Scripts

| Command                                   | What it does                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                             | protocol (`tsc -w`), hub and web, concurrently                                       |
| `npm run build`                           | builds protocol, then hub, then web                                                  |
| `npm run typecheck`                       | `tsc --noEmit` across workspaces (`vue-tsc` for web)                                 |
| `npm test`                                | vitest across workspaces                                                             |
| `npm run lint`                            | ESLint                                                                               |
| `npm run format` / `npm run format:check` | Prettier over the repo                                                               |
| `npm run e2e`                             | multi-client end-to-end suite — see [`scripts/e2e/README.md`](scripts/e2e/README.md) |

### Layout

| Path                | Contents                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/hub`          | Node gateway: TS3 client protocol, browser WebSocket, music-bot BFF, LiveKit tokens, file transfer |
| `apps/web`          | Vue 3 + Vite frontend                                                                              |
| `packages/protocol` | zod schemas for browser ⇄ hub messages, and the binary voice frame format                          |
| `deploy`            | docker-compose stacks, LiveKit, Caddy, Dockerfile                                                  |
| `scripts/e2e`       | end-to-end rig that drives several real clients at once                                            |
| `docs`              | roadmap and per-phase design notes                                                                 |

---

## Configuration

Every option is documented inline in
[`deploy/.env.example`](deploy/.env.example). The ones you will actually touch:

| Variable             | Purpose                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `HUB_PUBLIC_ORIGIN`  | The origin browsers use, exactly as it appears in the address bar. The origin checks depend on it.                        |
| `HUB_PASSWORD`       | Gateway password. Empty means anyone who can open the page can connect.                                                   |
| `HUB_SESSION_SECRET` | Signs the password cookie. The hub refuses to start in production if `HUB_PASSWORD` is set and this is still the default. |
| `HUB_TS_SERVER`      | Pin the hub to one TeamSpeak server (`host` or `host:port`). Users then only type a nickname.                             |
| `HUB_TRUST_PROXY`    | `1` behind a reverse proxy, `0` when the hub is directly reachable. See below.                                            |
| `MUSICBOT_URL`       | Default music bot, as reachable _from the hub_. Users may override it unless `HUB_TS_SERVER` is set.                      |
| `RTC_MODE`           | `auto` (LiveKit when configured, otherwise mesh), or `mesh` / `livekit` / `off`.                                          |
| `HUB_*_RATE_PER_MIN` | Abuse ceilings, per session and per IP.                                                                                   |

### Pinning one server

A private deployment usually only ever talks to one TeamSpeak server. Set
`HUB_TS_SERVER` (and `HUB_TS_PASSWORD`) and the login screen collapses to a
gateway password plus a nickname — the address, the server password and the bot
address that the browser sends are all ignored, and the address is never sent to
the browser at all.

Two companions for awkward networks:

- `HUB_FT_HOST` — dial a different host for file transfer (TCP 30033), e.g. when
  voice goes through a public name but the file port is not forwarded. Host only;
  the port comes from the server.
- `HUB_TS_PUBLIC_ADDRESS` — the address native clients know, used in `ts3file://`
  links posted in chat. Defaults to `HUB_TS_SERVER` when that is a domain; a bare
  IP is never handed to the browser.

---

## How voice works

- Browsers cannot send UDP, so each browser session is backed by a real TeamSpeak
  client in the hub — its own identity, its own nickname.
- Opus is encoded and decoded in the browser with WebCodecs; the hub only relays.
  Browsers without WebCodecs can listen (wasm decode) but not speak.
- Only **Opus Voice** and **Opus Music** channels are supported. Speex and CELT
  channels are listen-only from the web.
- The target is TeamSpeak 3. The hub detects a TS 6 peer (`detectFlavor` in
  `parse.ts`) and says so in the server info, but TS 6 is neither adapted nor tested.
- Microphone, camera and screen share require HTTPS (except on `localhost`).

### Video and screen share

Web users only — native clients cannot see it. Rooms follow the channel: change
channel, change room.

| Transport       | When                                                         | Notes                                                                                                                                            |
| --------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P2P mesh**    | Default, nothing extra to run                                | WebRTC between browsers; the hub only relays signalling. Each extra viewer costs the sender another upstream copy. Good for a handful of people. |
| **LiveKit SFU** | `LIVEKIT_URL` + `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` set | The sender uploads once. Use it for crowds.                                                                                                      |

Mesh mode uses Google's public STUN by default; peers behind strict NAT need a
TURN relay (coturn, for instance):

```bash
RTC_STUN_URLS=stun:stun.l.google.com:19302
RTC_TURN_URLS=turn:turn.example.com:3478
RTC_TURN_USERNAME=user
RTC_TURN_PASSWORD=<turn password>
```

---

## Security

The hub is the only path from a browser to TeamSpeak and to the music bot, so its
HTTP/WebSocket surface is deliberately narrow:

| Mechanism                | Behaviour                                                                                                                                                                                                                                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gateway password**     | With `HUB_PASSWORD` set, the browser must log in first; the hub returns a signed, HttpOnly, `SameSite=Strict` cookie valid for 30 days. Without it, every `/api/*` except `/api/health` and `/api/auth*` returns 401 and the WebSocket closes with 4401. Ten attempts per IP per minute. Changing the password or the secret logs everyone out. |
| **Origin**               | The WebSocket handshake and all writes accept only `HUB_PUBLIC_ORIGIN` and `HUB_ALLOWED_ORIGINS`. Development additionally allows any localhost port.                                                                                                                                                                                           |
| **Session binding**      | Every `/api/*` call needs the id of a session already connected to TeamSpeak. Uploads can only change the caller's own data — the UID comes from the session, never from the request.                                                                                                                                                           |
| **Rate limits**          | Concurrent sessions and API calls per IP; connects, commands, TTS and song requests per session. File transfers are budgeted per session, per TeamSpeak identity _and_ per IP, so extra tabs share one allowance. Playing chat video counts too — each open and each seek.                                                                      |
| **File transfer**        | Caps per session and hub-wide; stalled transfers are cut off. Channel-0 uploads are tighter still: 1 MiB avatars (also honouring `i_client_max_avatar_filesize`) and 64 KiB icons, whose CRC-32 filename is verified against the bytes.                                                                                                         |
| **Asset cache**          | Icons and avatars are cached under a byte budget and evicted least-recently-used. An avatar is only served when its MD5 matches `client_flag_avatar`, so nobody can park an image under someone else's hash.                                                                                                                                    |
| **Outbound targets**     | In production the hub refuses TeamSpeak addresses that resolve to private, loopback or link-local ranges (including cloud metadata at `169.254.169.254`), so it cannot be turned into an internal network probe. Explicitly allow-listed hosts are exempt.                                                                                      |
| **Music bot allow-list** | Only the paths song requests need pass through. Relative segments like `..` are rejected outright, and every segment is re-encoded before forwarding.                                                                                                                                                                                           |
| **Headers**              | `nosniff`, `no-referrer`, `frame-ancestors 'none'` everywhere; CSP on HTML; HSTS over HTTPS.                                                                                                                                                                                                                                                    |
| **Logs**                 | Session ids, download links and media links are replaced with `***`.                                                                                                                                                                                                                                                                            |

**`HUB_TRUST_PROXY` matters.** Behind a reverse proxy it must be `1`, or everyone
shares the proxy's single IP budget. With the hub directly reachable it must stay
off, or clients simply forge `X-Forwarded-For`. When on, the hub believes
forwarding headers only from loopback and private addresses (a Docker bridge, a
LAN proxy) and takes the first public address from the right.

**A session id is a credential.** It appears in icon, avatar, notification-sound
and TTS URLs, which is why the hub sends `Referrer-Policy: no-referrer` and
redacts it from logs — but be careful sharing screenshots and links.

---

## Troubleshooting a reverse-proxy deployment

| Symptom                                             | Cause and fix                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host is reachable but the port refuses connections  | `HUB_HOST` defaults to `127.0.0.1` so a bare dev hub is not exposed to the LAN. In a container it must be `0.0.0.0`, otherwise the published port forwards to nothing.                                                                       |
| Page loads, connecting fails, or `forbidden origin` | `HUB_PUBLIC_ORIGIN` must match the address bar **exactly**. Include a non-default port (`:8443`); case and a trailing slash are normalised, nothing else is.                                                                                 |
| Gateway disconnects with `code 1006`                | Also an origin mismatch: the hub closes with 4403, but proxies routinely drop the close frame, so the browser reports 1006. Check the origin before blaming the proxy.                                                                       |
| WebSocket never comes up behind the proxy           | The proxy must pass `Upgrade` / `Connection` through and use HTTP/1.1 upstream. Verify with the command below.                                                                                                                               |
| A TeamSpeak server on the same machine times out    | A public domain resolved inside the container leaves the network and comes back; most routers do not hairpin UDP. Use the LAN address and add it to `HUB_ALLOWED_TS_SERVERS` — allow-listed hosts are exempt from the private-range refusal. |

That last one is worth spelling out: production refuses private and loopback
TeamSpeak targets so the hub cannot be used to probe your network.
`HUB_ALLOW_PRIVATE_TS_SERVERS=1` opens the whole LAN; naming the one host in
`HUB_ALLOWED_TS_SERVERS` is the better trade. The cost is that the list doubles
as an allow-list for _everyone_ — once it is non-empty, users can no longer type
any other server.

To check that a WebSocket really reaches the hub (a proxy's 404 and the hub's 404
differ: the hub's carries CSP, `permissions-policy` and friends, a proxy's is
usually one line of text):

```bash
curl -isk -N --http1.1 --max-time 5 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
  -H "Origin: https://ts.example.com:8443" \
  https://ts.example.com:8443/ws
```

`101 Switching Protocols` followed by `{"type":"hello",...}` means it works.
`forbidden origin` means the origin is misconfigured. No 101 at all means the
proxy is not forwarding the upgrade.

---

## Music bot

The hub logs in to the bot's WebUI, proxies an allow-listed slice of its REST API
and relays its `/ws` state. Only a browser session already connected to TeamSpeak
may call those endpoints.

Each user can name their own bot on the login screen (`host`, `host:port` or a
full URL); with nothing entered the hub falls back to `MUSICBOT_URL`, and with
that empty too, to port 3000 on the TeamSpeak host. Sessions pointing at the same
bot share one connection.

The bot is not part of this repo's compose stack. `MUSICBOT_URL` only has to be
reachable _from the hub_: a containerised bot on the same Docker network (the
compose comments assume the service name `musicbot`), or something like
`http://host.docker.internal:3000` for a bot running on the host.
`MUSICBOT_USERNAME` / `MUSICBOT_PASSWORD` apply only to `MUSICBOT_URL`; every
other bot is joined in guest mode.

---

## User data

Avatars, icons, entry sounds, soundboard clips, stickers and Apps icons are
stored by the hub under `HUB_DATA_DIR` (`./data` by default, mounted as
`deploy/data` in compose). Uploads live in a `blobs/` subdirectory with an
`index.json` beside it, keyed by TeamSpeak identity UID — only the currently
connected owner can change their own entry.

Icons and entry sounds can be chosen before connecting: the file is held in the
browser's IndexedDB and previewed immediately, then uploaded once the connection
succeeds.

---

## Internationalisation

All UI strings live in `apps/web/src/i18n`. `zh-CN.ts` is the source language and
`en.ts` its translation; the two share a key set that the type system enforces.
A new language is one more `Messages` table listed in `LOCALES`. Users switch
language in the 👤 panel; the default follows the browser.

---

## Contributing

Issues and pull requests are welcome.

- Run `npm run typecheck`, `npm test` and `npm run format:check` before opening a
  PR — CI blocks the image build on all three.
- Commits follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`, `ci:`, `perf:`).
- Behaviour the e2e rig covers should come with a spec in `scripts/e2e/specs`.

## License

[MIT](LICENSE).

TeamSpeak is a trademark of TeamSpeak Systems GmbH. This project is not
affiliated with or endorsed by them.
