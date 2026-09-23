import { ref, watch } from "vue";
import { defineStore } from "pinia";
import { hub } from "../ts/hub";
import { useTsStore } from "./ts";
import { assetToken } from "../ts/asset-token";
import { locale, t } from "../i18n";
import { detectLanguage, fallbackFor, pickVoice } from "../tts/detectLanguage";
import {
  playClip,
  speakUtterance,
  type AudioLike,
  type Playback,
  type SynthLike,
  type UtteranceLike,
} from "../tts/playback";

export type TtsProvider = "browser" | "edge";

interface TtsSettings {
  enabled: boolean;
  provider: TtsProvider;
  /** Edge voice ShortName, e.g. zh-CN-XiaoxiaoNeural. */
  edgeVoice: string;
  /** Web Speech voice name (per browser). */
  browserVoice: string;
  volume: number; // 0..1
  rate: number; // 0.5..2 (1 = normal)
  readChannelChat: boolean;
  readServerChat: boolean;
  readPrivateChat: boolean;
  readPokes: boolean;
  readJoinLeave: boolean;
  readOwnMessages: boolean;
  speakSenderName: boolean;
}

const KEY = "jinz.tts.settings";
/** How long the volume slider must rest before the browser voice restarts at the new level. */
const VOLUME_SETTLE_MS = 250;

function load(): TtsSettings {
  const def: TtsSettings = {
    enabled: false,
    provider: "browser",
    edgeVoice: "zh-CN-XiaoxiaoNeural",
    browserVoice: "",
    volume: 0.8,
    rate: 1,
    readChannelChat: true,
    readServerChat: false,
    readPrivateChat: true,
    readPokes: true,
    readJoinLeave: true,
    readOwnMessages: false,
    speakSenderName: true,
  };
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...def, ...(JSON.parse(raw) as Partial<TtsSettings>) } : def;
  } catch {
    return def;
  }
}

export interface EdgeVoice {
  name: string;
  friendly: string;
  locale: string;
  gender: string;
}

/** Strips BBCode/URLs so the voice doesn't read markup aloud. */
function cleanForSpeech(text: string): string {
  return text
    .replace(/\[URL(=[^\]]*)?\]([\s\S]*?)\[\/URL\]/gi, t("tts.wordLink"))
    .replace(/\[IMG\][\s\S]*?\[\/IMG\]/gi, t("tts.wordImage"))
    .replace(/\[\/?[A-Z]+(=[^\]]*)?\]/gi, "")
    .replace(/https?:\/\/\S+/g, t("tts.wordLink"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export const useTtsStore = defineStore("tts", () => {
  const ts = useTsStore();
  const s = load();
  const enabled = ref(s.enabled);
  const provider = ref<TtsProvider>(s.provider);
  const edgeVoice = ref(s.edgeVoice);
  const browserVoice = ref(s.browserVoice);
  const volume = ref(s.volume);
  const rate = ref(s.rate);
  const readChannelChat = ref(s.readChannelChat);
  const readServerChat = ref(s.readServerChat);
  const readPrivateChat = ref(s.readPrivateChat);
  const readPokes = ref(s.readPokes);
  const readJoinLeave = ref(s.readJoinLeave);
  const readOwnMessages = ref(s.readOwnMessages);
  const speakSenderName = ref(s.speakSenderName);

  const edgeVoices = ref<EdgeVoice[]>([]);
  const browserVoices = ref<SpeechSynthesisVoice[]>([]);
  const speaking = ref(false);
  const error = ref<string | null>(null);
  const browserSupported = typeof window !== "undefined" && "speechSynthesis" in window;

  watch(
    [
      enabled,
      provider,
      edgeVoice,
      browserVoice,
      volume,
      rate,
      readChannelChat,
      readServerChat,
      readPrivateChat,
      readPokes,
      readJoinLeave,
      readOwnMessages,
      speakSenderName,
    ],
    () => {
      const data: TtsSettings = {
        enabled: enabled.value,
        provider: provider.value,
        edgeVoice: edgeVoice.value,
        browserVoice: browserVoice.value,
        volume: volume.value,
        rate: rate.value,
        readChannelChat: readChannelChat.value,
        readServerChat: readServerChat.value,
        readPrivateChat: readPrivateChat.value,
        readPokes: readPokes.value,
        readJoinLeave: readJoinLeave.value,
        readOwnMessages: readOwnMessages.value,
        speakSenderName: speakSenderName.value,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    },
  );

  /* ------------------------------- playback -------------------------------- */

  const queue: string[] = [];
  let playing = false;
  /** The phrase on air, so switching TTS off or moving the volume reaches it. */
  let current: Playback | null = null;
  /** A pending browser-voice restart at a new volume; see the volume watcher. */
  let revolume: ReturnType<typeof setTimeout> | null = null;

  async function drain(): Promise<void> {
    if (playing) return;
    playing = true;
    speaking.value = true;
    try {
      while (queue.length) {
        const text = queue.shift()!;
        try {
          if (provider.value === "edge") await speak(speakEdge(text));
          else await speak(speakBrowser(text));
          error.value = null;
        } catch (err) {
          error.value = err instanceof Error ? err.message : String(err);
          // Fall back to the browser voice once so the user still hears something.
          if (provider.value === "edge" && browserSupported) {
            try {
              await speak(speakBrowser(text));
            } catch {
              /* give up on this item */
            }
          }
        }
      }
    } finally {
      playing = false;
      speaking.value = false;
    }
  }

  async function speak(p: Playback): Promise<void> {
    current = p;
    try {
      await p.done;
    } finally {
      if (current === p) current = null;
    }
  }

  function speakEdge(text: string): Playback {
    const q = new URLSearchParams({
      text,
      voice: edgeVoice.value,
      rate: `${rate.value >= 1 ? "+" : "-"}${Math.round(Math.abs(rate.value - 1) * 100)}%`,
      token: assetToken(),
    });
    // The DOM's handler types take an event argument the playback never reads.
    const audio = new Audio(`/api/tts/speak?${q.toString()}`) as unknown as AudioLike;
    return playClip(audio, volume.value, () => new Error(t("tts.errEdge")));
  }

  function speakBrowser(text: string): Playback {
    if (!browserSupported) {
      return {
        done: Promise.reject(new Error(t("tts.errUnsupported"))),
        cancel() {},
        setVolume() {},
        restartsOnVolume: false,
      };
    }
    const make = () => {
      const u = new SpeechSynthesisUtterance(text);
      const chosen = browserVoices.value.find((x) => x.name === browserVoice.value);
      if (chosen) u.voice = chosen;
      else {
        // Automatic: match the voice to the message's script, not the UI language.
        const lang = detectLanguage(text, fallbackFor(locale.value));
        u.lang = lang;
        const auto = pickVoice(browserVoices.value, lang);
        if (auto) u.voice = auto;
      }
      u.rate = Math.max(0.5, Math.min(2, rate.value));
      return u as unknown as UtteranceLike;
    };
    return speakUtterance(
      window.speechSynthesis as unknown as SynthLike,
      make,
      volume.value,
      (reason) => new Error(t("tts.errSynthesis", { reason })),
    );
  }

  /** Silences whatever is being read now and drops what was waiting. */
  function stop(): void {
    queue.length = 0;
    if (revolume) clearTimeout(revolume);
    revolume = null;
    current?.cancel();
    current = null;
    if (browserSupported) window.speechSynthesis.cancel();
  }

  // Switching TTS off means quiet now, not after the current sentence.
  watch(enabled, (on) => {
    if (!on) stop();
  });

  // A new volume applies to the phrase already playing. The browser engine can
  // only do that by starting the phrase over, so it waits for the slider to rest
  // and then restarts that same phrase — not whichever one is on air by then.
  watch(volume, (v) => {
    const target = current;
    if (!target) return;
    if (!target.restartsOnVolume) {
      target.setVolume(v);
      return;
    }
    if (revolume) clearTimeout(revolume);
    revolume = setTimeout(() => {
      revolume = null;
      if (current === target) target.setVolume(volume.value);
    }, VOLUME_SETTLE_MS);
  });

  function enqueue(text: string): void {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    if (queue.length > 8) queue.shift(); // don't fall hopelessly behind a busy chat
    queue.push(clean);
    void drain();
  }

  /** Queue a phrase (ignored while TTS is off). */
  function say(text: string): void {
    if (enabled.value) enqueue(text);
  }

  /** Speak a sample with the current settings, whether or not TTS is on. */
  function test(): void {
    enqueue(t("tts.testPhrase"));
  }

  /* ------------------------------- voices ---------------------------------- */

  async function loadEdgeVoices(): Promise<void> {
    if (edgeVoices.value.length) return;
    try {
      const r = await fetch("/api/tts/voices");
      if (r.ok) edgeVoices.value = ((await r.json()) as { voices: EdgeVoice[] }).voices;
    } catch {
      /* offline */
    }
  }

  function loadBrowserVoices(): void {
    if (!browserSupported) return;
    browserVoices.value = window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => {
      browserVoices.value = window.speechSynthesis.getVoices();
    };
  }
  loadBrowserVoices();

  /* ------------------------------- triggers -------------------------------- */

  hub.onMessage((msg) => {
    if (!enabled.value) return;
    switch (msg.type) {
      case "text": {
        const own = msg.invokerId === ts.selfId;
        if (own && !readOwnMessages.value) return;
        const want =
          msg.targetMode === 3
            ? readServerChat.value
            : msg.targetMode === 2
              ? readChannelChat.value
              : readPrivateChat.value;
        if (!want) return;
        const who = speakSenderName.value && !own ? t("tts.saidBy", { name: msg.invokerName }) : "";
        say(`${who}${msg.message}`);
        break;
      }
      case "poked":
        if (readPokes.value) say(t("event.poked", { name: msg.invokerName, message: msg.message }));
        break;
      case "client.entered":
        if (
          readJoinLeave.value &&
          !msg.client.isSelf &&
          msg.client.channelId === ts.selfChannel?.id
        )
          say(t("event.clientEntered", { name: msg.client.nickname }));
        break;
      case "client.moved": {
        if (!readJoinLeave.value || msg.clientId === ts.selfId) return;
        const c = ts.clients.get(msg.clientId);
        const mine = ts.selfChannel?.id;
        if (!c || !mine) return;
        if (msg.channelId === mine) say(t("event.clientEntered", { name: c.nickname }));
        break;
      }
      case "client.left": {
        if (!readJoinLeave.value) return;
        const c = ts.clients.get(msg.clientId);
        if (c && !c.isSelf && c.channelId === ts.selfChannel?.id)
          say(t("event.clientLeft", { name: c.nickname }));
        break;
      }
      default:
        break;
    }
  });

  return {
    enabled,
    provider,
    edgeVoice,
    browserVoice,
    volume,
    rate,
    readChannelChat,
    readServerChat,
    readPrivateChat,
    readPokes,
    readJoinLeave,
    readOwnMessages,
    speakSenderName,
    edgeVoices,
    browserVoices,
    browserSupported,
    speaking,
    error,
    say,
    stop,
    test,
    loadEdgeVoices,
  };
});
