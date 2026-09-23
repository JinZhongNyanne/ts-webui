/**
 * Opus encode/decode for the browser.
 *
 * Primary path: WebCodecs (AudioEncoder / AudioDecoder with codec "opus").
 * Fallback for decoding: libopus compiled to wasm (`opus-decoder`).
 * There is no fallback encoder; browsers without WebCodecs can listen but not talk.
 */
import { Codec } from "@jinz/protocol";
import { t } from "../i18n";

export const SAMPLE_RATE = 48000;
export const FRAME_SAMPLES = 960; // 20 ms

export interface OpusEncoderLike {
  /** False when the frame was not taken (the encoder is closed or failed): no packet will follow. */
  encode(pcm: Float32Array): boolean;
  flush(): Promise<void>;
  close(): void;
}

export interface OpusDecoderLike {
  decode(payload: Uint8Array): void;
  close(): void;
  /** False once the decoder has errored or been closed; it can never decode again. */
  readonly usable: boolean;
}

export type EncodedHandler = (payload: Uint8Array) => void;
export type DecodedHandler = (left: Float32Array, right: Float32Array | null) => void;

export function hasWebCodecsAudioEncoder(): boolean {
  return typeof (globalThis as { AudioEncoder?: unknown }).AudioEncoder === "function";
}

export function hasWebCodecsAudioDecoder(): boolean {
  return typeof (globalThis as { AudioDecoder?: unknown }).AudioDecoder === "function";
}

export async function canEncodeOpus(): Promise<boolean> {
  if (!hasWebCodecsAudioEncoder()) return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: "opus",
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 1,
      bitrate: 32000,
    });
    return Boolean(support.supported);
  } catch {
    return false;
  }
}

export function bitrateForCodec(codec: number, quality: number): number {
  // TS3 channel quality 0..10 roughly maps 8..~96 kbps; keep voice modest.
  const base = codec === Codec.OpusMusic ? 48000 : 24000;
  return Math.round(
    base + (Math.max(0, Math.min(10, quality)) / 10) * (codec === Codec.OpusMusic ? 64000 : 24000),
  );
}

export async function createOpusEncoder(
  codec: number,
  quality: number,
  onEncoded: EncodedHandler,
  onError: (err: Error) => void,
): Promise<OpusEncoderLike> {
  if (!hasWebCodecsAudioEncoder()) throw new Error(t("audio.errNoWebCodecs"));
  let timestamp = 0;
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);
      onEncoded(buf);
    },
    error: (e) => onError(e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure({
    codec: "opus",
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitrate: bitrateForCodec(codec, quality),
    // @ts-expect-error opus-specific config is not in all lib.dom versions yet
    opus: { frameDuration: 20_000, application: codec === Codec.OpusMusic ? "audio" : "voip" },
  });
  return {
    encode(pcm) {
      if (encoder.state !== "configured") return false;
      const data = new AudioData({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: pcm.length,
        numberOfChannels: 1,
        timestamp,
        data: pcm as Float32Array<ArrayBuffer>,
      });
      timestamp += Math.round((pcm.length / SAMPLE_RATE) * 1_000_000);
      encoder.encode(data);
      data.close();
      return true;
    },
    async flush() {
      if (encoder.state === "configured") await encoder.flush();
    },
    close() {
      if (encoder.state !== "closed") encoder.close();
    },
  };
}

export async function createOpusDecoder(
  codec: number,
  onDecoded: DecodedHandler,
  onError: (err: Error) => void,
): Promise<OpusDecoderLike> {
  const channels = codec === Codec.OpusMusic ? 2 : 1;
  if (hasWebCodecsAudioDecoder()) {
    try {
      const support = await AudioDecoder.isConfigSupported({
        codec: "opus",
        sampleRate: SAMPLE_RATE,
        numberOfChannels: channels,
      });
      if (support.supported) return createWebCodecsDecoder(channels, onDecoded, onError);
    } catch {
      /* fall through to wasm */
    }
  }
  return createWasmDecoder(channels, onDecoded, onError);
}

function createWebCodecsDecoder(
  channels: number,
  onDecoded: DecodedHandler,
  onError: (err: Error) => void,
): OpusDecoderLike {
  let timestamp = 0;
  const decoder = new AudioDecoder({
    output: (audio) => {
      try {
        const frames = audio.numberOfFrames;
        const left = new Float32Array(frames);
        audio.copyTo(left, { planeIndex: 0, format: "f32-planar" });
        let right: Float32Array | null = null;
        if (audio.numberOfChannels > 1) {
          right = new Float32Array(frames);
          audio.copyTo(right, { planeIndex: 1, format: "f32-planar" });
        }
        onDecoded(left, right);
      } finally {
        audio.close();
      }
    },
    error: (e) => onError(e instanceof Error ? e : new Error(String(e))),
  });
  decoder.configure({ codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: channels });
  return {
    get usable() {
      return decoder.state === "configured";
    },
    decode(payload) {
      if (decoder.state !== "configured") return;
      const chunk = new EncodedAudioChunk({
        type: "key",
        timestamp,
        data: payload,
      });
      timestamp += 20_000;
      decoder.decode(chunk);
    },
    close() {
      if (decoder.state !== "closed") decoder.close();
    },
  };
}

async function createWasmDecoder(
  channels: number,
  onDecoded: DecodedHandler,
  onError: (err: Error) => void,
): Promise<OpusDecoderLike> {
  const { OpusDecoder } = await import("opus-decoder");
  const decoder = new OpusDecoder({ channels, sampleRate: SAMPLE_RATE });
  await decoder.ready;
  let alive = true;
  return {
    get usable() {
      return alive;
    },
    decode(payload) {
      if (!alive) return;
      try {
        const out = decoder.decodeFrame(payload);
        const left = out.channelData[0];
        if (!left) return;
        onDecoded(left, out.channelData[1] ?? null);
      } catch (err) {
        alive = false;
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    },
    close() {
      alive = false;
      decoder.free();
    },
  };
}
