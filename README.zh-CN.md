# JinzTS — 浏览器里的 TeamSpeak

[![docker](https://github.com/JinZhongNyanne/ts-webui/actions/workflows/docker.yml/badge.svg)](https://github.com/JinZhongNyanne/ts-webui/actions/workflows/docker.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)

**[English](README.md)**

一个跑在浏览器标签页里的完整 TeamSpeak 3 客户端：语音、频道树、聊天、文件传输、
管理与服务器设置，外加原生客户端没有的东西——Web 用户之间的摄像头 / 屏幕共享、
共享音效板、表情贴纸、语音播报，以及基于
[teamspeak-music-bot](https://github.com/ZHANGTIANYAO1/teamspeak-music-bot) 的点歌面板。

不用装任何东西：把网址和密码发给朋友，他们填个昵称就进频道了。

```
浏览器 (Vue 3)  ⇄ WebSocket ⇄  hub (Node)  ⇄ UDP ⇄  TeamSpeak 3 服务器
                                  │  ├─ 代理点歌机器人 REST/WS
                                  │  └─ 签发 LiveKit token
                                  └────── WebRTC ──── LiveKit（视频 / 屏幕共享）
```

对外暴露的只有 **hub** 一个服务。浏览器发不了 UDP，所以每个浏览器会话在 hub 里
对应一个真正的 TeamSpeak 客户端（独立身份、独立昵称）——对服务器上的其他人来说，
Web 用户和普通用户没有区别。

---

## 功能

| 方面           | 内容                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| **语音**       | 浏览器侧用 WebCodecs 编解码 Opus，每人独立音量（0–200%）、自动调平、输出限幅（护耳）、快捷键、说话权限、私语     |
| **频道与聊天** | 完整频道树（含各类 spacer）与频道订阅、完整 TeamSpeak BBCode、外链图片点击加载、IndexedDB 本地聊天记录、主机消息 |
| **文件**       | 频道文件浏览器、经 hub 流式上传 / 下载、聊天里的 `ts3file://` 链接、图片 / 视频 / 音频内联预览与拖动进度         |
| **管理**       | 踢出、移动、封禁（含封禁列表）、投诉、离线消息、客户端数据库、临时密码、服务器组、权限密钥、服务器设置与日志     |
| **视频**       | Web 用户之间的摄像头与屏幕共享——默认 P2P 直连，人多时用 LiveKit SFU                                              |
| **点歌**       | 点歌、队列、歌词、分平台的发现页、播放历史、guest 模式                                                           |
| **个性化**     | 头像与图标、个人进频道提示音、共享音效板、表情贴纸、渐变 / 毛玻璃主题、自定义 CSS                                |
| **外壳**       | Windows 风格桌面：浮动窗口、可拖出的标签页、Aero Snap、Snap Layouts、任务栏与壁纸；窄屏下切换到手机布局          |
| **平台**       | 可作为 PWA 安装、桌面通知、TTS 语音播报、简体中文与英文界面                                                      |

---

## 快速开始

### 直接拉现成镜像

整套只有一个业务容器：hub 同时负责返回打包好的 Web UI，不需要单独的前端容器。
前提是有 Docker 和一台 TeamSpeak 3 服务器。

```bash
git clone https://github.com/JinZhongNyanne/ts-webui.git
cd ts-webui/deploy
cp .env.example .env     # 至少改 HUB_PUBLIC_ORIGIN、HUB_SESSION_SECRET、DOMAIN
docker compose -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.ghcr.yml up -d
```

这会起 hub、LiveKit 和负责 HTTPS 的 Caddy。升级就是重新拉一次：

```bash
docker compose -f docker-compose.ghcr.yml pull hub
docker compose -f docker-compose.ghcr.yml up -d hub
```

镜像由 [`.github/workflows/docker.yml`](.github/workflows/docker.yml) 推到 GHCR：
main 的每次提交是 `latest` 和 `sha-<短哈希>`，打 `v*` 标签时另有 `1.2.3` / `1.2`。
在 `.env` 里用 `HUB_IMAGE` 和 `HUB_TAG` 选版本；生产环境建议钉住某个 tag，
别跟着 `latest` 走。

想在服务器上自己构建：`docker compose up -d --build`。

### 已经有反向代理？

已经有反代和证书（NAS、Zoraxy、nginx、群晖……）时不需要 compose 里的 Caddy——
整套东西只是一个容器，把它的 8080 暴露出去反代过来即可：

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
      HUB_ALLOWED_ORIGINS: "http://<本机内网地址>:5173"
      HUB_SESSION_SECRET: "<openssl rand -hex 32>"
      HUB_TRUST_PROXY: "1"
      HUB_PASSWORD: "<给朋友们的网关密码>"
      HUB_TS_SERVER: "<TS 服务器地址>:9987"
      HUB_TS_PASSWORD: "<TS 服务器密码，没有就留空>"
      MUSICBOT_URL: "https://bot.example.com:8443"
      MUSICBOT_INSECURE_TLS: "1"
      HUB_DATA_DIR: "/app/data"
    volumes:
      - <宿主机路径>/ts-webui/data:/app/data
```

反代**必须**原样转发 `Upgrade` / `Connection` 头，并且回源走 HTTP/1.1——
HTTP/2 不能升级 WebSocket。

---

## 本地开发

要求：Node ≥ 22，Docker（用于本地 TS3 服务器与 LiveKit）。

```bash
npm install
cp deploy/.env.example .env              # 注意：放在仓库根目录
docker compose -f deploy/docker-compose.dev.yml up -d
npm run dev                              # 同时启动 protocol(tsc -w) / hub / web
```

打开 <http://localhost:5173>，输入 `localhost:9987` 连接。`serveradmin` 密码只在
TS3 容器**第一次启动**时打印出来：`docker logs jinz-ts3`。

hub 只会读取**仓库根目录**或启动目录（cwd）下的 `.env`（见 `apps/hub/src/index.ts`）。
`deploy/.env` 只被 `docker compose` 读取，开发时的 hub 不会加载它。

### 常用脚本

| 命令                                      | 说明                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                             | 同时启动 protocol(`tsc -w`) / hub / web                             |
| `npm run build`                           | 依次构建 protocol、hub、web                                         |
| `npm run typecheck`                       | 所有 workspace 的 `tsc --noEmit`（web 用 `vue-tsc`）                |
| `npm test`                                | 所有 workspace 的 vitest                                            |
| `npm run lint`                            | ESLint                                                              |
| `npm run format` / `npm run format:check` | prettier 格式化 / 只检查                                            |
| `npm run e2e`                             | 多开端到端测试，见 [`scripts/e2e/README.md`](scripts/e2e/README.md) |

### 目录

| 路径                | 说明                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ |
| `apps/hub`          | Node 网关：TS3 客户端协议、浏览器 WebSocket、点歌机器人 BFF、LiveKit token、文件传输 |
| `apps/web`          | Vue 3 + Vite 前端                                                                    |
| `packages/protocol` | 浏览器 ⇄ hub 的消息 schema（zod）与语音二进制帧格式                                  |
| `deploy`            | docker-compose、LiveKit、Caddy、Dockerfile                                           |
| `scripts/e2e`       | 同时驱动多个真实客户端的端到端测试工具                                               |
| `docs`              | 路线图与各阶段的设计记录                                                             |

---

## 配置

全部选项都在 [`deploy/.env.example`](deploy/.env.example) 里带注释列出。常动的几个：

| 变量                 | 作用                                                                               |
| -------------------- | ---------------------------------------------------------------------------------- |
| `HUB_PUBLIC_ORIGIN`  | 浏览器实际使用的来源，必须和地址栏完全一致；来源检查依赖它。                       |
| `HUB_PASSWORD`       | 网关密码。留空 = 谁能打开页面谁就能连。                                            |
| `HUB_SESSION_SECRET` | 给密码 cookie 签名。生产环境设了 `HUB_PASSWORD` 却没改它时，hub 拒绝启动。         |
| `HUB_TS_SERVER`      | 把 hub 固定到一台 TS 服务器（`host` 或 `host:port`），用户就只需要填昵称。         |
| `HUB_TRUST_PROXY`    | 在反代后面设 `1`，hub 直接暴露时必须保持 `0`。见下文。                             |
| `MUSICBOT_URL`       | 默认点歌机器人，地址要从 **hub** 能访问到。没设 `HUB_TS_SERVER` 时用户可以自己填。 |
| `RTC_MODE`           | `auto`（配好 LiveKit 就用它，否则 P2P），也可写 `mesh` / `livekit` / `off`。       |
| `HUB_*_RATE_PER_MIN` | 按会话、按 IP 的各类频率上限。                                                     |

### 固定服务器 + 网关密码

私用的部署通常只连一台 TeamSpeak 服务器。设了 `HUB_TS_SERVER`（和 `HUB_TS_PASSWORD`）
之后，登录页就只剩网关密码和昵称——浏览器发来的地址、服务器密码和机器人地址一律忽略，
地址也根本不会发给浏览器。

网络别扭时还有两个帮手：

- `HUB_FT_HOST`——文件传输（TCP 30033）改连另一个主机，比如语音走公网域名、
  而文件端口在公网上没有转发。只写主机，端口由服务器告知。
- `HUB_TS_PUBLIC_ADDRESS`——原生客户端认识的服务器地址，用在聊天里发文件的
  `ts3file://` 链接上。不填时，`HUB_TS_SERVER` 是域名就用它；是 IP 则不告诉网页。

---

## 语音说明

- 浏览器发不了 UDP，所以每个浏览器连接在 hub 里对应一个真正的 TS 客户端。
- 语音在浏览器侧用 WebCodecs 编解码 Opus，hub 只做转发。没有 WebCodecs 的浏览器
  只能收听（用 wasm 解码）。
- 只支持 **Opus Voice** / **Opus Music** 频道；Speex / CELT 频道在 Web 端只能听。
- 目标是 TeamSpeak 3。hub 会识别对端是否为 TS 6（`parse.ts` 的 `detectFlavor`）
  并在服务器信息里标出来，但 TS 6 并未适配或测试过。
- 麦克风 / 摄像头 / 屏幕共享需要 HTTPS（`localhost` 除外）。

### 视频 / 屏幕共享

仅在 Web 用户之间互通（原生 TS 客户端看不到）。房间与 TS 频道绑定：换频道即换房间。

| 方式                 | 何时使用                                | 说明                                                                                          |
| -------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| **P2P 直连（mesh）** | 默认，无需额外服务                      | 浏览器之间直接走 WebRTC，hub 只做信令中继。每多一位观众，发送方就多上传一份画面，适合几个人。 |
| **LiveKit（SFU）**   | 配置了 `LIVEKIT_URL/API_KEY/API_SECRET` | 发送方只上传一份，适合人多的场景。                                                            |

P2P 模式下默认使用 Google 的公共 STUN；双方都在严格 NAT 后面时需要 TURN 中继
（例如 coturn）：

```bash
RTC_STUN_URLS=stun:stun.l.google.com:19302
RTC_TURN_URLS=turn:turn.example.com:3478
RTC_TURN_USERNAME=user
RTC_TURN_PASSWORD=<TURN 密码>
```

用法：状态栏「🖥️ 共享屏幕」一键开始（会自动加入频道视频房间）；视频面板里可开关
摄像头、调整共享质量（帧率 5–60 fps、分辨率上限、文字/动态优化、是否带系统声音），
双击画面放大，放大后可全屏或画中画。频道树里正在共享的人会带 🖥️ 标记，
右键 →「观看屏幕共享」或直接点标记即可观看。

---

## 安全

hub 是浏览器与 TeamSpeak / 点歌机器人之间唯一的出口，因此对外暴露的
HTTP / WebSocket 面做了以下限制：

| 机制             | 说明                                                                                                                                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 网关密码         | 设了 `HUB_PASSWORD` 时浏览器先输入密码，hub 回一个 30 天有效、HttpOnly + SameSite=Strict 的签名 cookie。没有它，除 `/api/health` 和 `/api/auth*` 以外的 `/api/*` 一律 401，WebSocket 以 4401 关闭。每 IP 每分钟最多试 10 次；改密码或改密钥会让所有人重新登录。 |
| 来源（Origin）   | WebSocket 握手与所有写操作只接受 `HUB_PUBLIC_ORIGIN` 和 `HUB_ALLOWED_ORIGINS` 里的来源；开发模式下额外放行任意 localhost 端口。                                                                                                                                 |
| 会话绑定         | `/api/*` 全部要求一个已连接 TS 服务器的会话 id。上传只能改自己（UID 取自会话，不信任请求参数）。                                                                                                                                                                |
| 频率限制         | 每 IP 的并发会话数与 API 次数、每会话的连接 / 指令 / TTS / 点歌次数都有上限。文件传输的次数同时按会话、按用户（TS 身份）和按 IP 计，多开标签页也占同一份额度；聊天里视频 / 音频的每次打开和拖动进度条也计入。                                                   |
| 文件传输         | 每会话（`HUB_FT_MAX_TRANSFERS_PER_SESSION`）和全 hub（`HUB_FT_MAX_TRANSFERS`）两道上限；停住不动的传输会被掐断。上传到频道 0 另有更小的上限：头像 1 MiB（并服从 `i_client_max_avatar_filesize`）、图标 64 KiB，图标还会先校验文件名里的 CRC-32 与内容是否一致。 |
| 图标 / 头像缓存  | 按字节数限额缓存，超出时丢掉最久没用的；头像只有 MD5 与 `client_flag_avatar` 相符时才会发给浏览器，因此别人不能把自己的图片挂在你的哈希下。                                                                                                                     |
| 出站目标         | 生产环境拒绝解析到内网 / 回环 / 链路本地（含云元数据 `169.254.169.254`）的 TeamSpeak 地址，避免 hub 变成内网探针；显式写进白名单的主机除外。                                                                                                                    |
| 机器人接口白名单 | 只有点歌需要的路径能穿过 hub；`..` 这类相对段一律拒绝（否则 `fetch` 的归一化会绕过白名单），转发前按段重新编码。                                                                                                                                                |
| 响应头           | 所有响应带 `nosniff`、`no-referrer`、`frame-ancestors 'none'`，HTML 另有 CSP，HTTPS 下加 HSTS。                                                                                                                                                                 |
| 日志             | 请求日志里的会话 id、下载链接和媒体播放链接会被替换成 `***`。                                                                                                                                                                                                   |

**`HUB_TRUST_PROXY` 很关键。** 放在反向代理后面时必须设 `1`，否则所有人共用代理的
那一个 IP 配额；直接暴露 hub 时必须保持关闭，否则客户端可以自己伪造 `X-Forwarded-For`。
打开后 hub 只相信来自回环 / 内网地址（docker 网桥、局域网里的反代）的转发头，
并取从右往左第一个公网地址作为客户端 IP。

**会话 id 相当于凭据。** 它出现在图标 / 头像 / 提示音 / TTS 的 URL 里，因此 hub 统一
发送 `Referrer-Policy: no-referrer` 并在日志里把它抹掉——但分享截图或链接时仍要留意。

---

## 反代部署踩过的坑

| 症状                                        | 原因与处理                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 宿主机能通，端口却 connection refused       | `HUB_HOST` 默认是 `127.0.0.1`（防止裸跑的 dev hub 被整个局域网访问）。容器里必须设成 `0.0.0.0`，否则发布的端口转发到一个没人监听的地址。               |
| 页面能开，连服务器失败 / `forbidden origin` | `HUB_PUBLIC_ORIGIN` 必须和地址栏里的来源**完全一致**。端口不是该协议的默认端口时（例如 `:8443`）必须带上；大小写和末尾斜杠会被归一化，其余一律不匹配。 |
| 网关断开，`code 1006`                       | 同样是来源不匹配：hub 用 4403 关闭连接，但关闭帧经过反代常常丢失，浏览器只好报 1006。先查来源，确认无误再怀疑反代。                                    |
| 反代下 WebSocket 起不来                     | 反代必须原样转发 `Upgrade` / `Connection` 头，并且回源走 HTTP/1.1。用下面的命令验证。                                                                  |
| 同一台机器上的 TS 服务器连不上（超时）      | 容器里解析公网域名会绕出去再回来，多数路由器不做 UDP 回流。改用内网地址，并把它写进 `HUB_ALLOWED_TS_SERVERS`——白名单里的主机可以豁免私网地址限制。     |

最后一条值得说明：生产环境默认拒绝解析到内网 / 回环的 TeamSpeak 地址，免得 hub 变成
探测内网的跳板。`HUB_ALLOW_PRIVATE_TS_SERVERS=1` 会把整个内网都放开，而写进
`HUB_ALLOWED_TS_SERVERS` 只豁免指定的那一台，更合适。代价是这个列表同时也是**所有人**的
白名单：一旦非空，用户就不能再填别的服务器了。

验证 WebSocket 是否真的通到了 hub（反代的 404 和 hub 的 404 不一样：hub 的响应带 CSP、
`permissions-policy` 等安全头，反代的通常是一行纯文本）：

```bash
curl -isk -N --http1.1 --max-time 5 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: x3JJHMbDL1EzLkh9GBhXDw==" \
  -H "Origin: https://ts.example.com:8443" \
  https://ts.example.com:8443/ws
```

看到 `101 Switching Protocols` 和一条 `{"type":"hello",...}` 就是通的；看到
`forbidden origin` 是来源没配对；连 101 都没有则是反代没转发升级请求。

麦克风只在 HTTPS 或 `localhost` 下可用，所以内网 HTTP 地址适合排查，日常使用还是走
反代的 HTTPS 域名。

---

## 点歌

hub 登录机器人 WebUI，代理白名单内的 REST 接口，并中继机器人的 `/ws` 实时状态。
只有已连接到 TS 服务器的浏览器会话才能调用点歌接口。

每个用户在登录页可以自己填机器人地址（`host`、`host:port` 或完整 URL），不填则用
`MUSICBOT_URL`；两者都空时默认为 TS 服务器主机的 3000 端口。多个会话指向同一机器人时
共用一条连接。

机器人本身不在本仓库的 compose 里。`MUSICBOT_URL` 指向 hub 能访问到的地址即可：
容器里的机器人要和 hub 在同一个 docker 网络上（compose 注释里假设服务名为 `musicbot`），
跑在宿主机上的机器人用 `http://host.docker.internal:3000` 之类的地址。
`MUSICBOT_USERNAME` / `MUSICBOT_PASSWORD` 只用于 `MUSICBOT_URL` 这台机器人；
其它机器人一律走 guest 模式。

---

## 其它功能

### 语音播报（TTS）

状态栏 🗣️ 按钮打开设置：开关、引擎（微软 Edge 免费神经语音，经 hub 的
`/api/tts/speak` 合成；或浏览器内置语音）、声音、音量、语速，以及播报哪些内容
（频道/私聊/服务器聊天、戳一下、进出频道）。音频只在本地播放，不会进入 TS 频道。

### 音量与护耳

- 右键用户 →「调整音量…」或在信息栏拖动滑块，单独调整每个人的音量（0–200%）。
- 语音设置里的「自动调平」按每个人最近 30 秒的响度把所有人拉到同一目标区间
  （可调目标 dB），主音量在其后生效。
- 「护耳」是输出端的限幅器：超过阈值的爆音瞬时压低、缓慢恢复，阈值可调。

### 个人图标与进频道提示音

状态栏 👤 按钮里每个人都可以上传：

- **图标**：PNG / JPG / GIF / WebP，最大 512 KB，显示在频道树里自己的名字旁边，
  所有 Web 用户都能看到。
- **进入频道提示音**：MP3 / OGG / WAV，最大 1 MB，你进入别人所在频道时在他们那边
  播放（音量跟随输出音量）。

两者都可以在连接之前就选好：文件先存在浏览器本地（IndexedDB）并立即预览，
连接成功后自动上传给所有人。

### 用户数据存放

头像、图标、提示音、音效板、贴纸和 Apps 图标由 hub 保存在 `HUB_DATA_DIR`
（默认 `./data`，compose 里挂载为 `deploy/data`）。上传的文件在 `blobs/` 子目录里，
索引 `index.json` 放在上一层，按 TeamSpeak 身份 UID 归属：只有当前已连接的本人
可以修改自己的那一份。老版本把文件和索引混在一起，hub 启动时会把认得的文件搬进
`blobs/`，不认识的一律不动。

### 界面语言

界面文案全部来自 `apps/web/src/i18n`：`zh-CN.ts` 是源语言，`en.ts` 是英文翻译，
两者键相同（类型会强制检查）。新增语言只要再加一个 `Messages` 表并在 `LOCALES` 里
列出即可；语言在 👤 面板里切换，默认跟随浏览器语言。

---

## 参与开发

欢迎提 issue 和 PR。

- 开 PR 前跑一遍 `npm run typecheck`、`npm test` 和 `npm run format:check`——
  CI 这三项不过就不会构建镜像。
- 提交信息遵循 Conventional Commits（`feat:`、`fix:`、`docs:`、`refactor:`、
  `test:`、`chore:`、`ci:`、`perf:`）。
- 端到端测试覆盖到的行为改动，请一并补 `scripts/e2e/specs` 里的 spec。

## 许可

[MIT](LICENSE)。

TeamSpeak 是 TeamSpeak Systems GmbH 的商标，本项目与其无关，也未获其背书。
