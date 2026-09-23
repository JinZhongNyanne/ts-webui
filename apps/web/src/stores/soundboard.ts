import { computed, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import {
  isOpusCodec,
  normalizeSoundName,
  soundNameFromFile,
  type ServerMessage,
  type SharedSound,
} from "@jinz/protocol";
import { hub } from "../ts/hub";
import { assetToken, hasAssetToken } from "../ts/asset-token";
import { useVoice } from "../audio/useVoice";
import type { ClipHandle } from "../audio/engine";
import { useTsStore } from "./ts";
import { useVoiceStore } from "./voice";
import {
  CLIP_COOLDOWN_MS,
  MAX_PLAYING_CLIPS,
  checkDuration,
  checkUploadFile,
  countDown,
  countUp,
  createCooldown,
  playBlocker,
  volumeToGain,
  type PlayBlock,
  type UploadError,
} from "../soundboard/rules";

/** Why the last clip did not play: a rule (see rules.ts), or a failure with the browser's reason. */
export type PlayNotice = { kind: PlayBlock } | { kind: "failed"; detail: string };

/** Bytes enough to recognise any supported format. */
const SNIFF_BYTES = 4096;
const SAMPLE_RATE = 48_000;

let decoder: OfflineAudioContext | null = null;

/**
 * Decodes a clip at the voice engine's rate. An offline context needs no user
 * gesture, so a file can be checked (and a clip prepared) before audio starts.
 */
function decode(data: ArrayBuffer): Promise<AudioBuffer> {
  decoder ??= new OfflineAudioContext(1, 1, SAMPLE_RATE);
  return decoder.decodeAudioData(data);
}

const UPLOAD_ERRORS: Readonly<Record<number, UploadError>> = {
  400: "name",
  409: "full",
  413: "tooBig",
  415: "type",
};

/**
 * The soundboard. The clips are the hub's and shared by everyone on it:
 * fetched on connect, then kept current by `sounds.updated` pushes whenever
 * anyone uploads, renames, re-levels or deletes one. Playing is this page's:
 * a clip goes into the channel through the voice engine (see
 * VoiceEngine.playClip) and to our own speakers.
 */
export const useSoundboardStore = defineStore("soundboard", () => {
  const ts = useTsStore();
  const voice = useVoice();
  const voiceState = useVoiceStore();
  const sounds = shallowRef<SharedSound[]>([]);
  const loaded = ref(false);
  /** Clips of each sound this page is playing now. */
  const playing = ref<Record<string, number>>({});
  const notice = ref<PlayNotice | null>(null);
  const handles = new Set<ClipHandle>();
  const cooldown = createCooldown(CLIP_COOLDOWN_MS);
  /** Decoded clips by id; a clip's file never changes under its id. */
  const buffers = new Map<string, Promise<AudioBuffer>>();

  const anyPlaying = computed(() => Object.keys(playing.value).length > 0);

  function setList(list: SharedSound[]): void {
    sounds.value = list;
    loaded.value = true;
    const ids = new Set(list.map((s) => s.id));
    for (const id of buffers.keys()) if (!ids.has(id)) buffers.delete(id);
  }

  function replace(sound: SharedSound): void {
    sounds.value = sounds.value.some((s) => s.id === sound.id)
      ? sounds.value.map((s) => (s.id === sound.id ? sound : s))
      : [...sounds.value, sound];
  }

  async function refresh(): Promise<void> {
    try {
      const res = await fetch("/api/sounds", { headers: { "x-session-id": ts.sessionId } });
      if (res.ok) setList(((await res.json()) as { sounds: SharedSound[] }).sounds);
    } catch {
      // Hub unreachable: the list stays as it was until the next push or connect.
    }
  }

  hub.onMessage((msg: ServerMessage) => {
    if (msg.type === "sounds.updated") setList(msg.sounds);
  });
  watch(
    () => ts.connState,
    (state) => {
      if (state === "connected") void refresh();
      else if (state === "idle") stopAll();
    },
    { immediate: true },
  );

  /** The hub-served file; null before an asset token arrives. */
  function fileUrl(sound: SharedSound): string | null {
    if (!hasAssetToken.value) return null;
    return `/api/sound-file/${encodeURIComponent(sound.id)}?token=${assetToken()}`;
  }

  function bufferOf(sound: SharedSound): Promise<AudioBuffer> {
    const cached = buffers.get(sound.id);
    if (cached) return cached;
    const url = fileUrl(sound);
    if (!url) return Promise.reject(new Error("no asset token"));
    const loading = fetch(url).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decode(await res.arrayBuffer());
    });
    buffers.set(sound.id, loading);
    // A failed load is not remembered, so the next click tries again.
    loading.catch(() => buffers.get(sound.id) === loading && buffers.delete(sound.id));
    return loading;
  }

  /** Uploads a clip for everyone; returns why not when it cannot. */
  async function upload(file: File, rawName: string): Promise<UploadError | null> {
    const head = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    const early = checkUploadFile(file.size, head, sounds.value.length);
    if (early) return early;
    const name = normalizeSoundName(rawName.trim() ? rawName : soundNameFromFile(file.name));
    if (!name) return "name";
    const data = await file.arrayBuffer();
    let buffer: AudioBuffer;
    try {
      // decodeAudioData takes the buffer over, so it gets a copy.
      buffer = await decode(data.slice(0));
    } catch {
      return "decode";
    }
    const long = checkDuration(buffer.duration);
    if (long) return long;
    try {
      const res = await fetch(`/api/sounds?name=${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "x-session-id": ts.sessionId, "content-type": "application/octet-stream" },
        body: data,
      });
      if (!res.ok) return UPLOAD_ERRORS[res.status] ?? "failed";
      const { sound } = (await res.json()) as { sound: SharedSound };
      buffers.set(sound.id, Promise.resolve(buffer));
      // The push may not have arrived yet.
      if (!sounds.value.some((s) => s.id === sound.id)) replace(sound);
      return null;
    } catch {
      return "failed";
    }
  }

  async function edit(id: string, patch: { name?: string; volume?: number }): Promise<boolean> {
    try {
      const res = await fetch(`/api/sounds/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "x-session-id": ts.sessionId, "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return false;
      replace(((await res.json()) as { sound: SharedSound }).sound);
      return true;
    } catch {
      return false;
    }
  }

  function rename(id: string, name: string): Promise<boolean> {
    const clean = normalizeSoundName(name);
    return clean ? edit(id, { name: clean }) : Promise.resolve(false);
  }

  function setVolume(id: string, volume: number): Promise<boolean> {
    return edit(id, { volume });
  }

  /** Deletes a clip for everyone. */
  async function remove(id: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/sounds/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-session-id": ts.sessionId },
      });
      if (res.ok || res.status === 404) setList(sounds.value.filter((s) => s.id !== id));
      return res.ok;
    } catch {
      return false;
    }
  }

  async function start(sound: SharedSound, toChannel: boolean): Promise<void> {
    if (handles.size >= MAX_PLAYING_CLIPS || !cooldown.take(performance.now())) return;
    notice.value = null;
    try {
      const buffer = await bufferOf(sound);
      const handle = await voice.playClip(buffer, {
        gain: volumeToGain(sound.volume),
        local: true,
        voice: toChannel,
      });
      handles.add(handle);
      playing.value = countUp(playing.value, sound.id);
      void handle.ended.then(() => {
        handles.delete(handle);
        playing.value = countDown(playing.value, sound.id);
      });
    } catch (err) {
      notice.value = { kind: "failed", detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Plays a clip into the channel (and to us), unless something forbids sending it. */
  async function play(sound: SharedSound): Promise<void> {
    const block = playBlocker({
      connected: ts.connState === "connected",
      inputMuted: ts.selfClient?.inputMuted ?? false,
      codecSupported: ts.selfChannel ? isOpusCodec(ts.selfChannel.codec) : true,
      canTalk: voiceState.canTalk,
      whisperPressed: voiceState.whisperPressed,
    });
    if (block) {
      notice.value = { kind: block };
      return;
    }
    await start(sound, true);
  }

  /** Plays a clip to this user only. */
  function preview(sound: SharedSound): Promise<void> {
    return start(sound, false);
  }

  /** Stops every clip this page started. */
  function stopAll(): void {
    for (const handle of [...handles]) handle.stop();
  }

  return {
    sounds,
    loaded,
    playing,
    anyPlaying,
    notice,
    upload,
    rename,
    setVolume,
    remove,
    play,
    preview,
    stopAll,
    refresh,
  };
});
