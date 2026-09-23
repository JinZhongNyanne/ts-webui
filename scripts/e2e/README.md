# 多开端到端测试（e2e rig）

用真实的 TS3 服务器、hub 和 vite，开几个浏览器客户端，验证“一个人做了什么，另一个人看到了什么”。
后面每个管理功能（踢人、封禁、编辑频道……）都应该在这里加一个 spec。

```bash
E2E_QUERY_PASSWORD='<serveradmin 密码>' npm run e2e            # 跑全部 spec
E2E_QUERY_PASSWORD=… npm run e2e -- smoke                       # 只跑文件名含 smoke 的
E2E_QUERY_PASSWORD=… npm run e2e -- dialogs --headed            # 看着浏览器跑
npm run e2e -- --help                                           # 全部参数
```

## 需要什么

- 一台能用 ServerQuery 登录的 TS3 服务器。本地开发用 `deploy/docker-compose.dev.yml` 里的就行，
  serveradmin 密码只在容器**第一次启动**时打印在 `docker logs <容器名>` 里。
- 已 `npm install`（Playwright 从仓库根目录解析；第一次用还要 `npx playwright install chromium`）。
- 8102（hub）和 5302（vite）两个端口空着；被占了就用 `--hub-port` / `--web-port` 换，
  或者用 `--hub-url` / `--web-url` 直接复用已经在跑的 hub 和 vite（必须是 dev 构建，
  rig 要用 `window.__jinzTs`）。

## 一次运行做了什么

1. **启动服务**：没给 `--hub-url` 就起一个 hub（无网关密码、不固定服务器、允许内网 TS 地址、
   放宽每 IP 的会话和频率限制，数据目录放在临时目录）；没给 `--web-url` 就起一个 vite，
   代理到这个 hub。两者都在自己的进程组里，结束时整组杀掉——**只杀自己起的进程**。
2. **准备服务器**：先删掉以前被打断的运行留下的权限密钥（描述以 `e2e-` 开头、且创建超过两小时的；
   别人的密钥、以及可能还在跑的运行的密钥都不碰），再用 ServerQuery 建一棵频道树 `e2e-<runId>`
   （下面 `-a`、`-b` 两个子频道，半永久），然后给 “Server Admin” 组生成一个权限密钥（`rig.privilegeKey`）。
3. **跑 spec**：`specs/*.spec.mjs` 按文件名顺序执行。每个 spec 自己开客户端，结束时 rig 关掉它们。
4. **清理**：关浏览器；删掉本次所有 Web 身份在服务器上的数据库记录、频道树和权限密钥；停掉 hub 和 vite。
   失败、异常、Ctrl+C 都会走清理。`--keep-open` 会让一切保持运行，按 Ctrl+C 时再清理。

所有昵称和频道都带本次的 `e2e-<runId>` 前缀，所以可以和别人共用一台测试服务器，
清理时也只删自己建的东西。rig 不改任何服务器级设置（密码、服务器名等）。

日志（`hub.log`、`vite.log`）和截图在 `$TMPDIR/jinz-e2e-<runId>/`，可以用 `--artifacts` 改；
spec 失败时会给每个客户端截一张 `fail-<spec>-<昵称>.png`。

## 写 spec

```js
// specs/kick.spec.mjs
import assert from "node:assert/strict";

export const title = "kick: admin kicks a client from the server";

export default async function (rig) {
  const admin = await rig.connect("admin", { admin: true }); // 进 e2e-<runId>-a，并加入 Server Admin
  const victim = await rig.connect("victim");
  await rig.waitForClientInTree(admin.page, victim.nick);
  // …在 admin.page 上点菜单，然后用 ServerQuery 核对结果：
  const list = await rig.serverQuery("clientlist");
  assert.ok(!list.some((c) => c.clid === victim.clid));
}
```

抛出异常即失败。rig 提供：

| 接口                                                       | 说明                                                                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rig.connect(nick, { channel, admin, viewport })`          | 新开一个浏览器上下文（全新身份）并连上服务器。`channel` 是 `"a"`、`"b"` 或 `null`（默认 `"a"`）。返回 `{ nick, page, context, clid, dbId, admin }` |
| `rig.makeAdmin(client)`                                    | 把客户端加进 Server Admin 组，并等到它自己的页面上看到这个组                                                                                       |
| `rig.waitForClientInTree(page, nick)`                      | 等到 `page` 的频道树里出现这个昵称                                                                                                                 |
| `rig.serverQuery("cmd a=1 b=x\\sy")`                       | 执行一条 ServerQuery 命令，返回解析好的记录数组；出错时抛 `QueryError`（带 `id`）                                                                  |
| `rig.sq.cmd(name, params)`                                 | 同上，参数自动转义                                                                                                                                 |
| `rig.sendChannelMessage(client, text, channelName)`        | 切到该频道的聊天面板并发送                                                                                                                         |
| `rig.waitForChatMessage(client, text, channelName, from?)` | 等到该频道聊天里出现这条消息                                                                                                                       |
| `rig.channels`                                             | `{ root, a, b }` 频道 id，`name("a")` 频道名，`path("a")` 默认频道路径                                                                             |
| `rig.privilegeKey` / `rig.adminGroupId`                    | Server Admin 的权限密钥和组 id                                                                                                                     |
| `rig.artifact(name)`                                       | 本次产物目录下的一个路径，用来存截图                                                                                                               |
| `rig.openChat(page, title)`                                | 从任务栏把这个聊天窗口调到最前                                                                                                                     |
| `rig.openFromDesktop(page, windowId)`                      | 点桌面图标打开窗口，并让它在最前。图标被窗口挡住时先“全部最小化”，点完再把原来显示着的窗口逐个还原，spec 不用自己挪窗口                            |

关于权限密钥：Web 端已经能兑换权限密钥（`privilegekeyuse`，服务器菜单和连接对话框的“更多选项”里都有），
`m4-server-admin.spec.mjs` 就在界面里兑换 `rig.privilegeKey`。其余 spec 只需要这个组，
所以 `admin: true` 仍由 rig 用 ServerQuery 的 `servergroupaddclient` 按数据库 id 直接加组，更快，效果相同。

## 现有 spec

| 文件                                  | 覆盖                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.mjs`                      | 两个客户端互相在频道树里看到对方，互发频道消息；admin 客户端确实在 Server Admin 组里                                                                                                                                                                                                                                                                                                                  |
| `dialogs.spec.mjs`                    | 通用对话框：焦点、Tab 不跑出去、Esc / 点背景关闭、从输入框拖到背景不关闭、Enter 提交戳一戳、`confirmDialog()`、手机宽度下是底部弹层                                                                                                                                                                                                                                                                   |
| `m1-client-features.spec.mjs`         | M1：连接后改昵称（含“昵称已被占用”）、离开消息和预设、头像（用一个普通 TS 客户端上传，看频道树 / 信息面板 / 聊天）、客户端描述（按权限显示，拒绝时提示缺哪个权限）、在需要发言权的频道里申请 / 给予 / 撤销 / 取消发言权、按频道订阅和“连接时订阅全部”关闭后的效果                                                                                                                                     |
| `soundboard.spec.mjs`                 | 音效板：上传后另一人无需刷新就看到，重命名同步，非音频文件被拒；关掉麦克风、以及按键说话但不按键时，点音效对方都看到在说话；“全部停止”立即结束；麦克风静音时不发送并提示原因；删除后双方都没有了                                                                                                                                                                                                      |
| `m2-channels.spec.mjs`                | M2 频道：admin 创建带密码和人数上限的子频道（先试一个重名的，服务器的拒绝显示在名称下面），另一个客户端看到；改名、话题、描述（BBCode 预览）；拖到另一个频道下面、再拖回两行之间、同级拖到最前（另一个客户端的树跟着变，包括服务器不通知的相邻频道）；用“移动频道…”对话框做同样的移动；里面有人时确认后强制删除                                                                                       |
| `m2-moderation.spec.mjs`              | M2 用户管理：拖动和“移动到…”（进有密码的频道）移动别人、踢出频道 / 服务器（被踢的人看到是谁、理由）、服务器组勾选、频道组、拒绝发言申请（菜单和信息面板）、频道指挥官；普通用户的菜单按权限显示，服务器拒绝时对话框里提示缺哪个权限；“移动到…”可以用方向键选频道；对象离开后踢人对话框自动关闭（下一个人可能拿到同一个 clid），封禁对话框改为按原来那人的 UID 封禁                                    |
| `m2-bans.spec.mjs`                    | M2 封禁：普通用户看不到封禁菜单；管理员从右键菜单按 UID 封禁（默认；“UID 和 IP”选项有警告），被封者断开并看到谁、多久、理由；封禁列表（服务器右键）里能看到、搜索、编辑（新建后删旧的）、删除（先确认），删除后被封者能重连；在列表里按 UID 添加封禁；“全部删除”先确认。只按 UID 封禁（所有 e2e 客户端同一个 IP），结束时删掉自己建的封禁                                                             |
| `m3-transfer.spec.mjs`                | M3 传输核心（通过 transfers store 驱动，文件浏览器界面还没有）：Server Admin 往有密码的频道上传 3 MB 随机文件，另一个客户端列出并下载，字节完全一致；密码错（列表和下载）、游客没有上传权限时给出可读的原因（点名 `i_ft_needed_file_upload_power`）；上传中途取消后服务器上不留文件                                                                                                                   |
| `m3-file-browser.spec.mjs`            | M3 文件浏览器（“文件”窗口，两个自建频道，结束时连文件一起删）：Server Admin 从频道右键打开、新建文件夹、把两个文件拖到列表上传、再拖一次同名的（确认后替换）、改名（改成已有的名字在对话框里被拒）；游客从窗口栏打开、选频道、双击下载（字节一致），新建文件夹和上传被拒并点名缺的权限；管理员多选删除（先确认）；有密码的频道先要密码（错了提示），之后不再问；手机宽度下是底部弹层且不横向滚动      |
| `m2-admin-tools.spec.mjs`             | M2 管理工具：普通用户看不到管理窗口；投诉（界面里投诉，管理员的投诉列表里按对象分组，删除一条 / 全部）；离线消息（给已下线用户的 UID 发，收件人用数据库搜索选出，重连后收件箱和服务器聊天里有未读提示，读后标记已读，删除）；客户端数据库（分页、搜索、改描述、删除本次建的条目）；临时密码（添加、列出、删除）；手机宽度下这些窗口是底部弹层且不横向滚动                                             |
| `m3-chat-files.spec.mjs`              | M3 聊天发文件：Server Admin 在频道聊天里用 📎 发文件，另一个客户端看到文件卡片（不是链接）并下载到完全一致的字节；同名再发变成 “ (2)”；粘贴截图得到自动生成的名字，点“预览”后经 hub 以 blob: 显示；按 TS3 客户端格式手打的 `ts3file://` 链接也显示成卡片并能下载；游客没有上传权限时在输入框上方看到原因（点名 `i_ft_needed_file_upload_power`），不发消息                                            |
| `m3-avatar-icons.spec.mjs`            | M3 头像和图标：游客裁剪上传头像，ServerQuery 看到 flag 是文件 md5，别的网页客户端看到，普通 TS 客户端按 UID 路径下载到同样字节；替换、删除即时生效。管理员上传图标（id = CRC-32，大于 2^31）和大图（缩小），设到临时服务器组、频道、用户，别人看到，再去掉并删除；游客看不到“图标…”                                                                                                                   |
| `m3-video-stream.spec.mjs`            | M3 视频流：聊天里的视频从 hub 的媒体链接按 Range 播放（206 + Content-Range），节流下往后拖动发出从中间开始的新请求并继续播放，该偏移处的字节和原文件一致；HEAD 只凭链接回答，超出末尾是 416，HTML 文件拿不到媒体链接；点海报时链接还有效就直接复用，链接已过期（页面时钟拨快 11 分钟）就像“播放”按钮一样先换一个新链接再打开，不会显示“无法播放”                                                      |
| `m4-server-admin.spec.mjs`            | M4 服务器管理：游客看不到管理窗口，在服务器菜单里兑换 rig 的权限密钥（先试一个错的）进 Server Admin，另一个客户端在连接对话框的“更多选项”里兑换；改虚拟服务器名、设横幅（点击前不请求横幅的主机，选择按服务器记住）；服务器组 / 频道组的添加、改名、排序、复制、删除（ServerQuery 核对，删除后页面自己的组列表也去掉它）；服务器日志、连接信息、权限来源；手机宽度下的窗口。改动都在 `finally` 里还原 |
| `m5-whisper.spec.mjs`                 | M5 悄悄话：按住悄悄话键只传给悄悄话列表里的人（另一个频道的 Bob 看到悄悄话样式，同频道不在列表里的 Carol 什么也看不到），Bob 屏蔽悄悄话后也看不到；没有悄悄话权限（服务器报告为 0）时悄悄话胶囊和设置页提示可能谁也听不到，但按键照常工作，有了权限提示消失                                                                                                                                           |
| `m5-talk-power.spec.mjs`              | M5 发言权：频道需要的发言权高于自己时，麦克风按钮显示“无发言权”、不发送任何语音、别人也看不到你在说话；成为 talker 后立即恢复。手机宽度下语音栏同样显示这个状态、说明原因，并提供不小于 44px 的“申请发言权”按钮                                                                                                                                                                                       |
| `desktop.spec.mjs`                    | 桌面：单击图标打开窗口，任务栏跟踪窗口，最小化 / 还原，两个吸附开关的初始状态和切换，关闭后图标还能再打开                                                                                                                                                                                                                                                                                             |
| `desktop-minimize-all.spec.mjs`       | 任务栏“全部最小化”：按一次清空桌面，再按一次只还原它收起的窗口，用户自己最小化的不还原                                                                                                                                                                                                                                                                                                                |
| `desktop-maximize-persist.spec.mjs`   | 最大化 / 还原位置精确，布局在刷新后保留（最小化的窗口仍是最小化），“重置布局”重建初始桌面                                                                                                                                                                                                                                                                                                             |
| `desktop-no-page-scroll.spec.mjs`     | 窗口拖出边缘时页面本身不会滚动                                                                                                                                                                                                                                                                                                                                                                        |
| `desktop-wallpaper.spec.mjs`          | 右键桌面更换背景图片和填充方式                                                                                                                                                                                                                                                                                                                                                                        |
| `desktop-snap-top.spec.mjs`           | 把窗口拖到顶边铺满桌面                                                                                                                                                                                                                                                                                                                                                                                |
| `desktop-snap-top-restore.spec.mjs`   | 从顶边铺满的窗口还原到拖动前的大小和位置                                                                                                                                                                                                                                                                                                                                                              |
| `desktop-snap-corner.spec.mjs`        | 拖进角落吸附成四分之一                                                                                                                                                                                                                                                                                                                                                                                |
| `desktop-snap-alt.spec.mjs`           | 按住 Alt 暂停吸附，窗口落在指针处                                                                                                                                                                                                                                                                                                                                                                     |
| `desktop-snap-window.spec.mjs`        | 和另一个窗口对齐时先显示落点预览                                                                                                                                                                                                                                                                                                                                                                      |
| `desktop-snap-layouts-drag.spec.mjs`  | 拖到顶边出现贴靠布局，放到某个格子里就吸附过去                                                                                                                                                                                                                                                                                                                                                        |
| `desktop-snap-layouts-hover.spec.mjs` | 悬停最大化按钮出现贴靠布局，点格子吸附                                                                                                                                                                                                                                                                                                                                                                |
| `desktop-snap-group-resize.spec.mjs`  | 调整已吸附窗口的大小时，同一条接缝上的窗口一起变，到最小尺寸为止                                                                                                                                                                                                                                                                                                                                      |
| `desktop-resize-snap.spec.mjs`        | 调整窗口大小，松手时边缘吸附到相邻窗口，够不着的不吸                                                                                                                                                                                                                                                                                                                                                  |
| `desktop-tab-tearout.spec.mjs`        | 把标签拖到桌面上变成独立窗口                                                                                                                                                                                                                                                                                                                                                                          |
| `desktop-tab-drop-desktop.spec.mjs`   | 窗口里唯一的标签拖到桌面上，就是把整个窗口移过去                                                                                                                                                                                                                                                                                                                                                      |
| `desktop-tab-stack.spec.mjs`          | 标签拖到窗口上叠成一组，拖到内容上再拆出来                                                                                                                                                                                                                                                                                                                                                            |
| `desktop-tab-split.spec.mjs`          | 标签拖到窗口边缘，把那个窗口一分为二                                                                                                                                                                                                                                                                                                                                                                  |
| `desktop-tab-snap-edge.spec.mjs`      | 拖着标签移动的窗口也会吸附到屏幕边缘                                                                                                                                                                                                                                                                                                                                                                  |
| `desktop-tab-snap-window.spec.mjs`    | 拖着标签移动的窗口也会和别的窗口对齐                                                                                                                                                                                                                                                                                                                                                                  |
| `desktop-tab-state.spec.mjs`          | 标签叠放和拆出之后，面板的实时状态和窗口都保留                                                                                                                                                                                                                                                                                                                                                        |

## 参数和环境变量

| 参数               | 环境变量             | 默认                    |
| ------------------ | -------------------- | ----------------------- |
| `--query-password` | `E2E_QUERY_PASSWORD` | （必填）                |
| `--query-user`     | `E2E_QUERY_USER`     | `serveradmin`           |
| `--query`          | `E2E_QUERY`          | `127.0.0.1:10011`       |
| `--sid`            | `E2E_SID`            | `1`                     |
| `--ts`             | `E2E_TS`             | `localhost:9987`        |
| `--ts-password`    | `E2E_TS_PASSWORD`    | 空                      |
| `--hub-port`       | `E2E_HUB_PORT`       | `8102`                  |
| `--web-port`       | `E2E_WEB_PORT`       | `5302`                  |
| `--hub-url`        | `E2E_HUB_URL`        | 空 = 自己启动           |
| `--web-url`        | `E2E_WEB_URL`        | 空 = 自己启动           |
| `--artifacts`      | `E2E_ARTIFACTS`      | `$TMPDIR/jinz-e2e-<id>` |
| `--headed`         |                      | 无头                    |
| `--keep-open`      |                      | 跑完即清理              |

rig 被 `kill -9` 之类强行打断时来不及清理：频道是半永久的，服务器重启就会消失；
留下的权限密钥由下一次运行在开始时删掉（见上面第 2 步，超过两小时的才删）；
也可以在 ServerQuery 里按 `e2e-<runId>` 前缀手动删频道（`channeldelete force=1`）、
权限密钥（`privilegekeylist` / `privilegekeydelete`）和身份（`clientdbfind pattern=%e2e-<runId>%` / `clientdbdelete`）。
