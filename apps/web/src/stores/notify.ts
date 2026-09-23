import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { ServerMessage } from "@jinz/protocol";
import { hub } from "../ts/hub";
import { t, type MessageKey } from "../i18n";
import { useTsStore } from "./ts";
import { useTtsStore } from "./tts";
import { useProfilesStore } from "./profiles";
import { useVoiceStore } from "./voice";
import {
  CUE_META,
  mergeSettings,
  type CueEvent,
  type CueEventSettings,
  type NotifySettings,
} from "../notify/events";
import {
  canTalk,
  cuesForMessage,
  selfFlagCues,
  type ClientLite,
  type Cue,
  type CueContext,
  type SelfFlags,
} from "../notify/cues";
import {
  createThrottle,
  notificationBody,
  notificationPermission,
  soundCoveredElsewhere,
  wantsDesktopNotification,
  type PermissionState,
} from "../notify/policy";
import {
  deleteCustomSound,
  loadCustomSounds,
  saveCustomSound,
  validateCustomSound,
  type CustomSoundError,
} from "../notify/customSounds";
import { CuePlayer } from "../notify/player";

const KEY = "jinz.notify.settings";

/** Messages that can change who is where; everything else leaves the snapshot alone. */
const TREE_MESSAGES = new Set<ServerMessage["type"]>([
  "connected",
  "snapshot",
  "client.entered",
  "client.left",
  "client.moved",
  "client.updated",
  "disconnected",
  "error",
]);

function load(): NotifySettings {
  try {
    const raw = localStorage.getItem(KEY);
    return mergeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return mergeSettings(null);
  }
}

function notificationApi(): typeof Notification | undefined {
  return typeof Notification === "undefined" ? undefined : Notification;
}

/**
 * The TS3-style sound pack and desktop notifications.
 *
 * It listens to the same hub stream the ts store does (after it, so the model
 * is already updated) and to our own client's flags, turns both into cues via
 * `notify/cues.ts`, and plays / shows them per the user's settings and the
 * rules in `notify/policy.ts` — which also describe how it stays out of the way
 * of TTS and per-user entry sounds.
 */
export const useNotifyStore = defineStore("notify", () => {
  const ts = useTsStore();
  const tts = useTtsStore();
  const profiles = useProfilesStore();
  const voice = useVoiceStore();

  const saved = load();
  const sounds = ref(saved.sounds);
  const notifications = ref(saved.notifications);
  const volume = ref(saved.volume);
  const events = reactive<Record<CueEvent, CueEventSettings>>(saved.events);
  const permission = ref<PermissionState>(notificationPermission(notificationApi()));
  /** Events with a user-supplied sound. */
  const customSounds = reactive(new Map<CueEvent, string>());
  const error = ref<CustomSoundError | "decode" | "storage" | null>(null);

  watch(
    [sounds, notifications, volume, events],
    () => {
      const data: NotifySettings = {
        sounds: sounds.value,
        notifications: notifications.value,
        volume: volume.value,
        events: JSON.parse(JSON.stringify(events)) as NotifySettings["events"],
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    },
    { deep: true },
  );

  const player = new CuePlayer();
  void player.setSink(voice.outputDeviceId);
  watch(
    () => voice.outputDeviceId,
    (id) => void player.setSink(id),
  );

  void loadCustomSounds().then((list) => {
    for (const s of list) {
      customSounds.set(s.event, s.name);
      player.setCustom(s.event, s.blob);
    }
  });

  /* ------------------------------ detection ------------------------------ */

  function snapshot(): CueContext {
    const clients = new Map<number, ClientLite>();
    for (const c of ts.clients.values()) {
      clients.set(c.id, {
        channelId: c.channelId,
        nickname: c.nickname,
        uid: c.uid,
        isSelf: c.isSelf,
      });
    }
    return {
      selfId: ts.selfId,
      selfChannelId: ts.selfChannel?.id ?? null,
      connected: ts.connState === "connected",
      clients,
    };
  }

  /** The model as of the previous message; see `notify/cues.ts` for why. */
  let before = snapshot();

  hub.onMessage((msg) => {
    const cues = cuesForMessage(msg, before);
    if (TREE_MESSAGES.has(msg.type)) before = snapshot();
    for (const cue of cues) fire(cue);
  });
  hub.onState((state) => {
    // The gateway itself went away while we were in a server: to the user that
    // is a lost connection, same as a TeamSpeak-side timeout.
    if (state === "closed" && before.connected) fire({ event: "connectionLost" });
    before = snapshot();
  });

  const selfFlags = computed<SelfFlags | null>(() => {
    const me = ts.selfClient;
    if (!me || ts.connState !== "connected") return null;
    const needed = ts.selfChannel?.neededTalkPower ?? 0;
    return {
      clientId: me.id,
      channelId: me.channelId,
      inputMuted: me.inputMuted,
      outputMuted: me.outputMuted,
      away: me.away,
      canTalk: canTalk(me.talkPower, me.isTalker, needed),
    };
  });
  watch(selfFlags, (next, prev) => {
    for (const cue of selfFlagCues(prev ?? null, next)) fire(cue);
  });
  // Voice, not a hub message, says a whisper began (see audio/useVoice.ts);
  // blocked whispers never get this far.
  watch(
    () => voice.lastWhisper,
    (w) => {
      if (!w) return;
      const from = ts.clients.get(w.clientId);
      fire({ event: "whisperReceived", name: from?.nickname, uid: from?.uid });
    },
  );

  /* ------------------------------- output -------------------------------- */

  const throttle = createThrottle();

  function fire(cue: Cue): void {
    const setting = events[cue.event];
    if (!throttle(cue.event, Date.now())) return;
    if (sounds.value && setting.sound && !soundCoveredElsewhere(cue, announcers())) {
      void player.play(cue.event, volume.value);
    }
    if (notifications.value && setting.notify && CUE_META[cue.event].notifiable) notify(cue);
  }

  function announcers() {
    return {
      ttsEnabled: tts.enabled,
      ttsReadsJoinLeave: tts.readJoinLeave,
      ttsReadsPokes: tts.readPokes,
      ttsReadsChannelChat: tts.readChannelChat,
      ttsReadsServerChat: tts.readServerChat,
      ttsReadsPrivateChat: tts.readPrivateChat,
      hasEntrySound: (uid: string) => profiles.hasSound(uid),
    };
  }

  function label(event: CueEvent): string {
    return t(`notify.event.${event}` as MessageKey);
  }

  function notify(cue: Cue): void {
    const api = notificationApi();
    if (!api || api.permission !== "granted") return;
    const page = {
      hidden: document.visibilityState === "hidden",
      focused: document.hasFocus(),
    };
    if (!wantsDesktopNotification(page)) return;
    try {
      const n = new api(label(cue.event), {
        body: notificationBody(cue),
        // One live popup per event kind: a burst of messages replaces instead of stacking.
        tag: `jinz-${cue.event}`,
      });
      n.onclick = () => {
        window.focus();
        if (cue.conversation) ts.openConversation(cue.conversation);
        n.close();
      };
    } catch {
      // Some mobile browsers expose the constructor but only allow service-worker
      // notifications; the sound (if any) already played, so just skip it.
    }
  }

  /** Re-reads the permission; the user may have changed it in the site settings. */
  function refreshPermission(): void {
    permission.value = notificationPermission(notificationApi());
  }

  /** Asks for notification permission. Must run inside a click handler. */
  async function requestPermission(): Promise<PermissionState> {
    const api = notificationApi();
    if (!api) return (permission.value = "unsupported");
    try {
      permission.value = await api.requestPermission();
    } catch {
      permission.value = api.permission;
    }
    return permission.value;
  }

  /**
   * Turning desktop notifications on is itself the gesture that may ask for
   * permission. A refusal leaves the switch on but the UI explains why nothing
   * appears, instead of silently flipping it back.
   */
  async function setNotifications(on: boolean): Promise<void> {
    notifications.value = on;
    if (on && permission.value === "default") await requestPermission();
  }

  /* ---------------------------- custom sounds ---------------------------- */

  async function setCustomSound(event: CueEvent, file: File): Promise<void> {
    error.value = validateCustomSound(file);
    if (error.value) return;
    if (!(await player.check(file))) {
      error.value = "decode";
      return;
    }
    try {
      await saveCustomSound({ event, blob: file, name: file.name });
    } catch {
      error.value = "storage";
      return;
    }
    customSounds.set(event, file.name);
    player.setCustom(event, file);
  }

  async function clearCustomSound(event: CueEvent): Promise<void> {
    error.value = null;
    customSounds.delete(event);
    player.setCustom(event, null);
    await deleteCustomSound(event);
  }

  /** Settings preview: plays regardless of the switches, at the current volume. */
  function preview(event: CueEvent): void {
    void player.play(event, volume.value);
  }

  return {
    sounds,
    notifications,
    volume,
    events,
    permission,
    customSounds,
    error,
    label,
    refreshPermission,
    requestPermission,
    setNotifications,
    setCustomSound,
    clearCustomSound,
    preview,
  };
});
