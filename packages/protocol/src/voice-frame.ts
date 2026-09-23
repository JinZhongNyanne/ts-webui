/**
 * Binary WebSocket frame used for voice in both directions.
 *
 *   byte 0      frame kind (see VoiceFrameKind)
 *   bytes 1..2  clientId, big-endian u16 (0 for upstream frames)
 *   byte 3      codec (TeamSpeak codec id, 4 or 5 for Opus)
 *   bytes 4..5  sequence number, big-endian u16 (wraps)
 *   bytes 6..   Opus payload (may be empty to signal end-of-talk)
 *
 * A whisper is a kind of its own rather than a flags byte: the header stays at
 * six bytes, and a decoder that predates whispers rejects the frame outright
 * instead of playing a whisper as if it were said to the whole channel.
 */

export const VOICE_FRAME_HEADER = 6;

export const VoiceFrameKind = {
  /** Browser -> hub: my microphone. */
  Up: 0,
  /** Hub -> browser: another client's voice. */
  Down: 1,
  /** Browser -> hub: my microphone, whispered to the targets set by `whisper.set`. */
  UpWhisper: 2,
  /** Hub -> browser: another client whispering to me. */
  DownWhisper: 3,
} as const;
export type VoiceFrameKind = (typeof VoiceFrameKind)[keyof typeof VoiceFrameKind];

/** Voice travelling from the browser to the hub (said or whispered). */
export function isUpstreamKind(kind: number): boolean {
  return kind === VoiceFrameKind.Up || kind === VoiceFrameKind.UpWhisper;
}

/** Voice travelling from the hub to the browser (heard in the channel or whispered). */
export function isDownstreamKind(kind: number): boolean {
  return kind === VoiceFrameKind.Down || kind === VoiceFrameKind.DownWhisper;
}

export function isWhisperKind(kind: number): boolean {
  return kind === VoiceFrameKind.UpWhisper || kind === VoiceFrameKind.DownWhisper;
}

function isKnownKind(kind: number): kind is VoiceFrameKind {
  return isUpstreamKind(kind) || isDownstreamKind(kind);
}

export interface VoiceFrame {
  kind: VoiceFrameKind;
  clientId: number;
  codec: number;
  seq: number;
  payload: Uint8Array;
}

export function encodeVoiceFrame(frame: VoiceFrame): Uint8Array {
  const out = new Uint8Array(VOICE_FRAME_HEADER + frame.payload.byteLength);
  out[0] = frame.kind;
  out[1] = (frame.clientId >>> 8) & 0xff;
  out[2] = frame.clientId & 0xff;
  out[3] = frame.codec & 0xff;
  out[4] = (frame.seq >>> 8) & 0xff;
  out[5] = frame.seq & 0xff;
  out.set(frame.payload, VOICE_FRAME_HEADER);
  return out;
}

export function decodeVoiceFrame(buf: Uint8Array): VoiceFrame | null {
  if (buf.byteLength < VOICE_FRAME_HEADER) return null;
  const kind = buf[0]!;
  if (!isKnownKind(kind)) return null;
  return {
    kind,
    clientId: (buf[1]! << 8) | buf[2]!,
    codec: buf[3]!,
    seq: (buf[4]! << 8) | buf[5]!,
    payload: buf.subarray(VOICE_FRAME_HEADER),
  };
}
