/**
 * Wires the VoiceEngine to the Pinia stores. Call once from the app shell.
 */
import { watch } from "vue";
import { isOpusCodec, type WhisperTarget } from "@jinz/protocol";
import { useTsStore } from "../stores/ts";
import { useVoiceStore } from "../stores/voice";
import { hub } from "../ts/hub";
import { VoiceEngine, type ClipHandle, type ClipOptions } from "./engine";
import type { MicProcessing } from "./processing";
import type { GateState } from "./engine";
import { mayTalk } from "./talk-power";
import { resolveWhisperTargets } from "../components/whisper/whisper-targets";

/**
 * How long the hub keeps the whisper target after the key comes up. The last
 * frames leave the encoder a little after the end-of-whisper marker; they
 * must still find their targets rather than be dropped.
 */
const WHISPER_TARGET_LINGER_MS = 300;

let engine: VoiceEngine | null = null;
let api: VoiceApi | null = null;

export interface VoiceApi {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  enableMic: () => Promise<void>;
  disableMic: () => Promise<void>;
  toggleMic: () => Promise<void>;
  /** Starts audio if needed and plays a soundboard clip (see VoiceEngine.playClip). */
  playClip: (buffer: AudioBuffer, opts: ClipOptions) => Promise<ClipHandle>;
  /** Stops every soundboard clip this page is playing. */
  stopClips: () => void;
}

/**
 * Plays a clip through the voice mixer (master volume, speaker mute, limiter).
 * False when the engine is not running or the clip could not be played.
 */
export function playThroughMixer(url: string): Promise<boolean> {
  return engine?.running ? engine.playEffect(url) : Promise.resolve(false);
}

/** Singleton: watchers and key listeners are installed once for the whole app. */
export function useVoice(): VoiceApi {
  if (api) return api;
  api = createVoiceApi();
  return api;
}

function createVoiceApi(): VoiceApi {
  const ts = useTsStore();
  const voice = useVoiceStore();

  function ensureEngine(): VoiceEngine {
    if (engine) return engine;
    engine = new VoiceEngine(hub, {
      onRemoteTalking: (clientId, talking) => {
        if (talking) ts.talking.add(clientId);
        else ts.talking.delete(clientId);
      },
      onSelfTalking: (talking, whisper) => {
        voice.transmitting = talking;
        if (talking) ts.talking.add(ts.selfId);
        else ts.talking.delete(ts.selfId);
        if (talking && whisper) voice.whispering.add(ts.selfId);
        else voice.whispering.delete(ts.selfId);
      },
      onRemoteWhisper: (clientId, whispering) => {
        if (!whispering) {
          voice.whispering.delete(clientId);
          return;
        }
        voice.whispering.add(clientId);
        voice.lastWhisper = { clientId, at: Date.now() };
      },
      onLevel: (rms) => {
        voice.level = rms;
      },
      onMeter: (clients, master) => {
        for (const [id, m] of Object.entries(clients)) voice.clientLevels[id] = m;
        for (const id of Object.keys(voice.clientLevels)) {
          if (!(id in clients)) delete voice.clientLevels[id];
        }
        voice.masterMeter = master;
      },
      onError: (message) => {
        voice.error = message;
        ts.pushEvent(message, "error");
      },
      onMicProcessing: (applied) => {
        voice.micApplied = applied;
      },
    });
    // Before the first enableMic, so the very first track already honours them.
    void engine.setProcessing(micProcessing());
    return engine;
  }

  /** Starts the audio context (needs a user gesture) and applies settings. */
  async function start(): Promise<void> {
    const e = ensureEngine();
    if (e.running) return;
    await e.start(voice.outputDeviceId || undefined);
    voice.engineReady = true;
    voice.canEncode = e.canEncode;
    e.setMasterVolume(voice.master);
    e.setMicVolume(voice.micVolume);
    e.setOutputMuted(ts.selfClient?.outputMuted ?? false);
    e.setTransmitMuted(ts.selfClient?.inputMuted ?? false);
    e.setBlockWhispers(voice.whisperPolicy === "block");
    e.setGate(gateState());
    e.setAutoLevel(voice.autoLevel, voice.autoLevelTargetDb);
    e.setLimiter(voice.earProtect, voice.earProtectDb);
    applyCodec();
    applyGains();
    await voice.refreshDevices();
  }

  watch(
    () => [voice.autoLevel, voice.autoLevelTargetDb] as const,
    ([on, target]) => engine?.setAutoLevel(on, target),
  );
  watch(
    () => [voice.earProtect, voice.earProtectDb] as const,
    ([on, db]) => engine?.setLimiter(on, db),
  );

  async function stop(): Promise<void> {
    if (!engine) return;
    await engine.stop();
    voice.engineReady = false;
    voice.micEnabled = false;
    voice.transmitting = false;
  }

  async function enableMic(): Promise<void> {
    voice.error = null;
    try {
      await start();
      await ensureEngine().enableMic(voice.inputDeviceId || undefined);
      voice.micEnabled = true;
      await voice.refreshDevices();
    } catch (err) {
      voice.error = err instanceof Error ? err.message : String(err);
      voice.micEnabled = false;
    }
  }

  async function disableMic(): Promise<void> {
    await engine?.disableMic();
    voice.micEnabled = false;
    voice.micApplied = null;
    voice.transmitting = false;
    ts.talking.delete(ts.selfId);
  }

  async function toggleMic(): Promise<void> {
    if (voice.micEnabled) await disableMic();
    else await enableMic();
  }

  function applyCodec(): void {
    const ch = ts.selfChannel;
    if (!ch || !engine) return;
    voice.codecSupported = isOpusCodec(ch.codec);
    engine.setCodec(ch.codec, ch.codecQuality);
  }

  function applyGains(): void {
    if (!engine) return;
    for (const c of ts.clients.values()) {
      if (!c.isSelf) engine.setClientGain(c.id, voice.gainFor(c.uid));
    }
  }

  function gateState(): GateState {
    return {
      mode: voice.mode,
      threshold: voice.threshold,
      pttPressed: voice.pttPressed,
      whisperPressed: voice.whisperPressed,
      canTalk: voice.canTalk,
    };
  }

  /* ------------------------------- whisper ------------------------------- */

  let whisperRelease: number | null = null;

  function sendWhisperTarget(target: WhisperTarget | null): void {
    if (ts.connState !== "connected") return;
    hub.send({ type: "whisper.set", target });
  }

  /**
   * The whisper key went down: name the targets to the hub before the first
   * whispered frame, so none arrives with nowhere to go. Resolved now, not
   * when the list was edited, because the tree has moved on since.
   */
  function beginWhisper(): void {
    if (whisperRelease !== null) window.clearTimeout(whisperRelease);
    whisperRelease = null;
    const resolved = resolveWhisperTargets(voice.whisperList, {
      channels: [...ts.channels.values()],
      clients: [...ts.clients.values()],
      selfChannelId: ts.selfChannel?.id ?? null,
    });
    // Shown at once; replaced by what the hub actually kept when it answers.
    voice.whisperTarget = resolved;
    sendWhisperTarget({ channels: resolved.channels, clients: resolved.clients });
    engine?.setGate(gateState());
  }

  /** The key came up: end the whisper (the gate sends its end marker) and later drop the target. */
  function endWhisper(): void {
    engine?.setGate(gateState());
    voice.whisperTarget = null;
    if (whisperRelease !== null) window.clearTimeout(whisperRelease);
    whisperRelease = window.setTimeout(() => {
      whisperRelease = null;
      if (!voice.whisperPressed) sendWhisperTarget(null);
    }, WHISPER_TARGET_LINGER_MS);
  }

  // Synchronous, so the target reaches the hub before the gate opens and the
  // end marker leaves before the target is dropped.
  watch(
    () => voice.whisperPressed,
    (down) => (down ? beginWhisper() : endWhisper()),
    { flush: "sync" },
  );

  hub.onMessage((msg) => {
    if (msg.type !== "whisper.target" || !voice.whisperPressed || !voice.whisperTarget) return;
    voice.whisperTarget = {
      channels: msg.channels,
      clients: msg.clients,
      truncated: voice.whisperTarget.truncated,
    };
  });

  watch(
    () => voice.whisperPolicy,
    (policy) => engine?.setBlockWhispers(policy === "block"),
  );

  // D1: no talk power, no transmission. Recomputed from the live model, so a
  // granted talk request or a move to another channel takes effect at once.
  watch(
    () => mayTalk(ts.selfClient, ts.selfChannel),
    (can) => {
      voice.canTalk = can;
    },
    { immediate: true },
  );

  function micProcessing(): MicProcessing {
    return {
      echoCancellation: voice.echoCancellation,
      noiseSuppression: voice.noiseSuppression,
      autoGainControl: voice.autoGainControl,
      rnnoise: voice.rnnoise,
    };
  }

  // --- reactive wiring ---
  watch(micProcessing, async (p) => {
    try {
      await engine?.setProcessing(p);
    } catch (err) {
      voice.error = err instanceof Error ? err.message : String(err);
      // The engine drops the mic when it could not reopen it at all.
      if (engine && !engine.micEnabled) await disableMic();
    }
  });
  watch(() => ts.selfChannel?.id, applyCodec);
  watch(
    () =>
      [voice.mode, voice.threshold, voice.pttPressed, voice.whisperPressed, voice.canTalk] as const,
    () => engine?.setGate(gateState()),
  );
  watch(
    () => voice.master,
    (v) => engine?.setMasterVolume(v),
  );
  watch(
    () => voice.micVolume,
    (v) => engine?.setMicVolume(v),
  );
  watch(
    () => voice.clientGains,
    () => applyGains(),
    { deep: true },
  );
  watch(
    () => ts.selfClient?.outputMuted ?? false,
    (muted) => engine?.setOutputMuted(muted),
  );
  watch(
    () => ts.selfClient?.inputMuted ?? false,
    (muted) => engine?.setTransmitMuted(muted),
  );
  watch(
    () => voice.outputDeviceId,
    (id) => {
      if (id) void engine?.setOutputDevice(id);
    },
  );
  watch(
    () => voice.inputDeviceId,
    async () => {
      if (voice.micEnabled) {
        await disableMic();
        await enableMic();
      }
    },
  );
  watch(
    () => ts.connState,
    async (state) => {
      if (state === "connected") {
        applyGains();
        if (voice.autoMic && voice.engineReady && !voice.micEnabled) await enableMic();
      } else if (state === "idle") {
        await disableMic();
        ts.talking.clear();
        voice.whispering.clear();
        voice.whisperTarget = null;
      }
    },
  );
  // Give newcomers their saved gain (a user muted last session is otherwise
  // audible until the next settings change) and free the decoder + mixer slot
  // of clients that left.
  const knownClients = new Set<number>();
  watch(
    () => Array.from(ts.clients.keys()),
    (ids) => {
      const present = new Set(ids);
      for (const id of knownClients) {
        if (present.has(id)) continue;
        knownClients.delete(id);
        engine?.removeClient(id);
        ts.talking.delete(id);
      }
      for (const id of present) {
        if (knownClients.has(id)) continue;
        knownClients.add(id);
        const c = ts.clients.get(id);
        if (c && !c.isSelf) engine?.setClientGain(id, voice.gainFor(c.uid));
      }
    },
    { immediate: true },
  );

  // Push-to-talk keys (and the other hotkeys) are handled by hotkeys/useHotkeys.ts,
  // which sets `voice.pttPressed`; the gate watcher above picks that up.

  async function playClip(buffer: AudioBuffer, opts: ClipOptions): Promise<ClipHandle> {
    await start();
    return ensureEngine().playClip(buffer, opts);
  }

  return {
    start,
    stop,
    enableMic,
    disableMic,
    toggleMic,
    playClip,
    stopClips: () => engine?.stopClips(),
  };
}
