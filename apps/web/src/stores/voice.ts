import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { AppliedProcessing } from "../audio/processing";
import type { WhisperList } from "../components/whisper/whisper-targets";
import {
  EMPTY_SAVED_WHISPER_LIST,
  sanitiseSavedWhisperList,
  saveWhisperList,
  whisperListFor,
  whisperServerKey,
  type SavedWhisperList,
} from "../components/whisper/whisper-saved";
import { useTsStore } from "./ts";
import { useHubAccessStore } from "./hubAccess";

export type VoiceMode = "vad" | "ptt";

/**
 * Whispers from others: heard and marked, or dropped unheard. TeamSpeak
 * lets everyone with enough whisper power whisper to anyone; this is the
 * receiving side's say in it.
 */
export type WhisperPolicy = "allow" | "block";

/** The hub's answer to `whisper.set`: the targets it will really whisper to. */
export interface WhisperTargetState {
  channels: string[];
  clients: number[];
  /** The list named more than one whisper may carry. */
  truncated: boolean;
}

interface PersistedVoiceSettings {
  mode: VoiceMode;
  threshold: number;
  pttKey: string;
  inputDeviceId: string;
  outputDeviceId: string;
  /** Output volume (everyone else in our speakers). */
  master: number;
  /** Input volume (our microphone as others hear it). */
  micVolume: number;
  clientGains: Record<string, number>;
  autoMic: boolean;
  /** Auto-level: normalize each speaker's recent loudness to a common target. */
  autoLevel: boolean;
  autoLevelTargetDb: number;
  /** Hearing protection: limit output peaks above this level. */
  earProtect: boolean;
  earProtectDb: number;
  /** Browser mic processing; see audio/processing.ts. Off suits music / instruments. */
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** Extra RNNoise suppression in our own graph (opt-in, loads a small wasm). */
  rnnoise: boolean;
  /** Who the whisper hold-key whispers to; hand-picked channels per server. */
  whisperList: SavedWhisperList;
  whisperPolicy: WhisperPolicy;
}

const KEY = "jinz.voice.settings";

function load(): PersistedVoiceSettings {
  const def: PersistedVoiceSettings = {
    mode: "vad",
    threshold: 0.02,
    pttKey: "KeyV",
    inputDeviceId: "",
    outputDeviceId: "",
    master: 1,
    micVolume: 1,
    clientGains: {},
    autoMic: true,
    autoLevel: false,
    autoLevelTargetDb: -18,
    earProtect: true,
    earProtectDb: -6,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    rnnoise: false,
    whisperList: EMPTY_SAVED_WHISPER_LIST,
    whisperPolicy: "allow",
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const saved = JSON.parse(raw) as Partial<PersistedVoiceSettings>;
    return {
      ...def,
      ...saved,
      whisperList: sanitiseSavedWhisperList(saved.whisperList),
      whisperPolicy: saved.whisperPolicy === "block" ? "block" : "allow",
    };
  } catch {
    return def;
  }
}

export const useVoiceStore = defineStore("voice", () => {
  const saved = load();
  const mode = ref<VoiceMode>(saved.mode);
  const threshold = ref(saved.threshold);
  const pttKey = ref(saved.pttKey);
  const inputDeviceId = ref(saved.inputDeviceId);
  const outputDeviceId = ref(saved.outputDeviceId);
  const master = ref(saved.master);
  const micVolume = ref(saved.micVolume);
  const clientGains = reactive<Record<string, number>>({ ...saved.clientGains });
  const autoMic = ref(saved.autoMic);
  const autoLevel = ref(saved.autoLevel);
  const autoLevelTargetDb = ref(saved.autoLevelTargetDb);
  const earProtect = ref(saved.earProtect);
  const earProtectDb = ref(saved.earProtectDb);
  const echoCancellation = ref(saved.echoCancellation);
  const noiseSuppression = ref(saved.noiseSuppression);
  const autoGainControl = ref(saved.autoGainControl);
  const rnnoise = ref(saved.rnnoise);
  const savedWhisperList = ref<SavedWhisperList>(saved.whisperList);
  const ts = useTsStore();
  const access = useHubAccessStore();
  /** The server hand-picked whisper channels are filed under (whisper-saved.ts). */
  const whisperServer = computed(() =>
    whisperServerKey(ts.server, {
      host: ts.profile.host,
      port: ts.profile.port,
      fixed: access.fixedServer,
    }),
  );
  /**
   * Who the whisper hold-key whispers to on the server we are on. Everything
   * reads and edits the list through this, so no caller can ever be handed —
   * or overwrite — the channels picked on another server.
   */
  const whisperList = computed<WhisperList>({
    get: () => whisperListFor(savedWhisperList.value, whisperServer.value),
    set: (next) => {
      savedWhisperList.value = saveWhisperList(savedWhisperList.value, whisperServer.value, next);
    },
  });
  const whisperPolicy = ref<WhisperPolicy>(saved.whisperPolicy);

  // Runtime state (not persisted).
  /** Live per-client meters from the mixer (keyed by TS client id). */
  const clientLevels = reactive<
    Record<string, { rmsDb: number; avgDb: number | null; autoGainDb: number }>
  >({});
  const masterMeter = ref<{ peakDb: number; reductionDb: number }>({
    peakDb: -180,
    reductionDb: 0,
  });
  const engineReady = ref(false);
  const micEnabled = ref(false);
  const transmitting = ref(false);
  const pttPressed = ref(false);
  /** The whisper hold-key is down (see hotkeys/useHotkeys.ts). */
  const whisperPressed = ref(false);
  /** What the hub accepted for the whisper in progress; null while not whispering. */
  const whisperTarget = ref<WhisperTargetState | null>(null);
  /** We have the talk power our channel asks for (roadmap D1; see audio/talk-power.ts). */
  const canTalk = ref(true);
  /** Clients (ourselves included) whose current transmission is a whisper. */
  const whispering = reactive(new Set<number>());
  /** The latest whisper to reach us, for the notification cue; bumped per new whisper. */
  const lastWhisper = ref<{ clientId: number; at: number } | null>(null);
  const level = ref(0);
  const canEncode = ref<boolean | null>(null);
  const codecSupported = ref(true);
  const error = ref<string | null>(null);
  const inputDevices = ref<MediaDeviceInfo[]>([]);
  const outputDevices = ref<MediaDeviceInfo[]>([]);
  /** What the browser actually applied to the current mic track (null = mic off). */
  const micApplied = ref<AppliedProcessing | null>(null);

  watch(
    [
      mode,
      threshold,
      pttKey,
      inputDeviceId,
      outputDeviceId,
      master,
      micVolume,
      clientGains,
      autoMic,
      autoLevel,
      autoLevelTargetDb,
      earProtect,
      earProtectDb,
      echoCancellation,
      noiseSuppression,
      autoGainControl,
      rnnoise,
      savedWhisperList,
      whisperPolicy,
    ],
    () => {
      const data: PersistedVoiceSettings = {
        mode: mode.value,
        threshold: threshold.value,
        pttKey: pttKey.value,
        inputDeviceId: inputDeviceId.value,
        outputDeviceId: outputDeviceId.value,
        master: master.value,
        micVolume: micVolume.value,
        autoLevel: autoLevel.value,
        autoLevelTargetDb: autoLevelTargetDb.value,
        earProtect: earProtect.value,
        earProtectDb: earProtectDb.value,
        clientGains: { ...clientGains },
        autoMic: autoMic.value,
        echoCancellation: echoCancellation.value,
        noiseSuppression: noiseSuppression.value,
        autoGainControl: autoGainControl.value,
        rnnoise: rnnoise.value,
        whisperList: savedWhisperList.value,
        whisperPolicy: whisperPolicy.value,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    },
    { deep: true },
  );

  function gainFor(uid: string): number {
    return clientGains[uid] ?? 1;
  }

  function setGain(uid: string, value: number): void {
    if (value === 1) delete clientGains[uid];
    else clientGains[uid] = value;
  }

  async function refreshDevices(): Promise<void> {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      inputDevices.value = devices.filter((d) => d.kind === "audioinput");
      outputDevices.value = devices.filter((d) => d.kind === "audiooutput");
    } catch {
      /* permissions not granted yet */
    }
  }

  return {
    mode,
    threshold,
    pttKey,
    inputDeviceId,
    outputDeviceId,
    master,
    micVolume,
    clientGains,
    autoMic,
    engineReady,
    micEnabled,
    transmitting,
    pttPressed,
    level,
    canEncode,
    codecSupported,
    error,
    inputDevices,
    outputDevices,
    autoLevel,
    autoLevelTargetDb,
    earProtect,
    earProtectDb,
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    rnnoise,
    whisperList,
    whisperPolicy,
    whisperPressed,
    whisperTarget,
    canTalk,
    whispering,
    lastWhisper,
    micApplied,
    clientLevels,
    masterMeter,
    gainFor,
    setGain,
    refreshDevices,
  };
});
