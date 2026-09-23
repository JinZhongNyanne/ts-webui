import { describe, expect, it } from "vitest";
import { ClientMessageSchema } from "./messages.js";
import { WHISPER_MAX_TARGETS, WhisperSetSchema } from "./whisper.js";

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => from + i);

describe("whisper.set", () => {
  it("accepts channel and client targets", () => {
    const r = WhisperSetSchema.safeParse({
      type: "whisper.set",
      target: { channels: ["1", "22"], clients: [5] },
    });
    expect(r.success).toBe(true);
  });

  it("accepts null, which ends whispering", () => {
    expect(WhisperSetSchema.safeParse({ type: "whisper.set", target: null }).success).toBe(true);
  });

  it("is part of the client message union", () => {
    const r = ClientMessageSchema.safeParse({
      type: "whisper.set",
      target: { channels: [], clients: [7] },
    });
    expect(r.success).toBe(true);
  });

  it("caps channels and clients together at the anti-flood limit", () => {
    expect(WHISPER_MAX_TARGETS).toBe(32);
    const at = {
      type: "whisper.set",
      target: { channels: ids(16).map(String), clients: ids(16) },
    };
    const over = {
      type: "whisper.set",
      target: { channels: ids(16).map(String), clients: ids(17) },
    };
    expect(WhisperSetSchema.safeParse(at).success).toBe(true);
    expect(WhisperSetSchema.safeParse(over).success).toBe(false);
    expect(
      WhisperSetSchema.safeParse({
        type: "whisper.set",
        target: { channels: [], clients: ids(33) },
      }).success,
    ).toBe(false);
  });

  it("refuses malformed ids", () => {
    const bad = [
      { channels: ["abc"], clients: [] },
      { channels: ["-1"], clients: [] },
      { channels: [], clients: [70000] },
      { channels: [], clients: [1.5] },
      { channels: "1", clients: [] },
    ];
    for (const target of bad) {
      expect(WhisperSetSchema.safeParse({ type: "whisper.set", target }).success).toBe(false);
    }
  });
});
