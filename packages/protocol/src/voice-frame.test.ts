import { describe, expect, it } from "vitest";
import {
  decodeVoiceFrame,
  encodeVoiceFrame,
  isDownstreamKind,
  isUpstreamKind,
  isWhisperKind,
  VoiceFrameKind,
  VOICE_FRAME_HEADER,
} from "./voice-frame.js";

describe("voice frame codec", () => {
  it("round-trips a downstream frame", () => {
    const payload = new Uint8Array([1, 2, 3, 250]);
    const buf = encodeVoiceFrame({
      kind: VoiceFrameKind.Down,
      clientId: 0x1234,
      codec: 5,
      seq: 0xbeef,
      payload,
    });
    expect(buf.byteLength).toBe(VOICE_FRAME_HEADER + payload.byteLength);
    const frame = decodeVoiceFrame(buf);
    expect(frame).not.toBeNull();
    expect(frame!.kind).toBe(VoiceFrameKind.Down);
    expect(frame!.clientId).toBe(0x1234);
    expect(frame!.codec).toBe(5);
    expect(frame!.seq).toBe(0xbeef);
    expect(Array.from(frame!.payload)).toEqual([1, 2, 3, 250]);
  });

  it("accepts an empty payload (end-of-talk marker)", () => {
    const buf = encodeVoiceFrame({
      kind: VoiceFrameKind.Up,
      clientId: 0,
      codec: 4,
      seq: 7,
      payload: new Uint8Array(0),
    });
    const frame = decodeVoiceFrame(buf);
    expect(frame!.payload.byteLength).toBe(0);
    expect(frame!.seq).toBe(7);
  });

  it("rejects short or unknown frames", () => {
    expect(decodeVoiceFrame(new Uint8Array([0, 1]))).toBeNull();
    expect(decodeVoiceFrame(new Uint8Array([9, 0, 0, 4, 0, 0, 1]))).toBeNull();
  });

  it("round-trips every frame kind, whispers included", () => {
    for (const kind of Object.values(VoiceFrameKind)) {
      const buf = encodeVoiceFrame({
        kind,
        clientId: 42,
        codec: 4,
        seq: 1,
        payload: new Uint8Array([9]),
      });
      expect(buf.byteLength).toBe(VOICE_FRAME_HEADER + 1);
      expect(decodeVoiceFrame(buf)?.kind).toBe(kind);
    }
  });

  it("gives whispers their own kinds, not a flag", () => {
    expect(VoiceFrameKind.UpWhisper).toBe(2);
    expect(VoiceFrameKind.DownWhisper).toBe(3);
    expect(isWhisperKind(VoiceFrameKind.UpWhisper)).toBe(true);
    expect(isWhisperKind(VoiceFrameKind.DownWhisper)).toBe(true);
    expect(isWhisperKind(VoiceFrameKind.Up)).toBe(false);
    expect(isWhisperKind(VoiceFrameKind.Down)).toBe(false);
  });

  it("tells the two directions apart", () => {
    expect(isUpstreamKind(VoiceFrameKind.Up)).toBe(true);
    expect(isUpstreamKind(VoiceFrameKind.UpWhisper)).toBe(true);
    expect(isUpstreamKind(VoiceFrameKind.Down)).toBe(false);
    expect(isDownstreamKind(VoiceFrameKind.Down)).toBe(true);
    expect(isDownstreamKind(VoiceFrameKind.DownWhisper)).toBe(true);
    expect(isDownstreamKind(VoiceFrameKind.UpWhisper)).toBe(false);
  });

  it("still rejects the first kind past the known ones", () => {
    expect(decodeVoiceFrame(new Uint8Array([4, 0, 0, 4, 0, 0, 1]))).toBeNull();
  });
});
