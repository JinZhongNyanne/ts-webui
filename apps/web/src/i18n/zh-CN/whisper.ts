/**
 * Chinese (Simplified) strings for whispering: sending, receiving and the whisper-list settings pane.
 * Keys are prefixed by UI area, as in `core.ts`; `as const` keeps each key a
 * literal so `t()` can check it.
 */
export const whisper = {
  "whisper.tab": "悄悄话",
  "whisper.intro": "按住悄悄话快捷键时，你的声音只传给下面列出的频道和用户，不进当前频道。",
  "whisper.hotkey": "按住 {key} 说悄悄话。",
  "whisper.hotkeyUnbound": "还没有设置悄悄话快捷键，请到“快捷键”里绑定。",
  "whisper.targets.title": "悄悄话对象",
  "whisper.preset.channel": "当前频道",
  "whisper.preset.parent": "上级频道",
  "whisper.preset.parents": "所有上级频道",
  "whisper.preset.subchannels": "子频道",
  "whisper.preset.family": "当前频道及其全部子频道",
  "whisper.preset.all": "所有频道",
  "whisper.preset.commanders": "所有频道指挥官",
  "whisper.channels.title": "指定频道",
  "whisper.channels.add": "添加频道…",
  "whisper.clients.title": "指定用户",
  "whisper.clients.add": "添加在线用户…",
  "whisper.remove": "移除",
  "whisper.offline": "（不在线）",
  "whisper.unknownChannel": "频道 {id}（不在当前服务器）",
  "whisper.preview": "现在按下，会传给 {channels} 个频道、{clients} 位用户。",
  "whisper.previewEmpty": "现在按下不会传给任何人。",
  "whisper.truncated": "对象超过 {max} 个，超出的部分会被忽略。",
  "whisper.receive.title": "接收",
  "whisper.receive.allow": "接收别人的悄悄话",
  "whisper.receive.block": "屏蔽所有悄悄话",
  "whisper.pill": "悄悄话 → {channels} 个频道 · {clients} 人",
  "whisper.pillNone": "悄悄话：没有可传达的对象",
  "whisper.pillTruncated": "（已截断）",
  "whisper.noPower": "无悄悄话权限",
  "whisper.noPowerHint":
    "你没有悄悄话权限（i_client_whisper_power 为 0）：服务器会不声不响地丢掉发给需要这项权限的人的悄悄话，所以这次可能谁也听不到。",
  "whisper.treeHint": "正在说悄悄话",
  "voice.noTalkPower": "无发言权",
  "notify.event.whisperReceived": "收到悄悄话",
} as const;
