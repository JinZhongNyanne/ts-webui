/**
 * Runs the real mixer worklet (public/worklets/mixer.js) outside a browser:
 * the AudioWorklet globals it expects are stubbed, and `process` is driven by
 * hand, one 128-sample block at a time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

interface Mixer {
  port: { onmessage: ((ev: { data: unknown }) => void) | null; postMessage: () => void };
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

let MixerClass: new () => Mixer;

beforeAll(() => {
  const source = readFileSync(
    fileURLToPath(new URL("../../public/worklets/mixer.js", import.meta.url)),
    "utf8",
  );
  class Processor {
    port = { onmessage: null, postMessage: () => undefined };
  }
  const register = (_name: string, cls: new () => Mixer) => (MixerClass = cls);
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
    Processor,
    register,
    48_000,
  );
});

function send(mixer: Mixer, data: unknown): void {
  mixer.port.onmessage?.({ data });
}

/** One block with a constant-level stereo clip on the effects input; returns the output peak. */
function block(mixer: Mixer, level: number | null): number {
  const input =
    level === null ? [] : [new Float32Array(128).fill(level), new Float32Array(128).fill(level)];
  const out = [new Float32Array(128), new Float32Array(128)];
  mixer.process([input], [out]);
  return Math.max(...out[0]!.map(Math.abs), ...out[1]!.map(Math.abs));
}

describe("mixer effects input", () => {
  it("plays what is connected to it, at the master volume", () => {
    const mixer = new MixerClass();
    send(mixer, { type: "master", value: 0.5 });
    expect(block(mixer, 0.4)).toBeCloseTo(0.2);
    expect(block(mixer, null)).toBe(0);
  });

  it("goes through the limiter", () => {
    const mixer = new MixerClass();
    send(mixer, { type: "limiter", on: true, thresholdDb: -6 });
    const threshold = Math.pow(10, -6 / 20);
    for (let i = 0; i < 20; i++) expect(block(mixer, 0.95)).toBeLessThanOrEqual(threshold + 1e-4);
  });

  it("is silent while the speakers are muted", () => {
    const mixer = new MixerClass();
    send(mixer, { type: "mute", on: true });
    expect(block(mixer, 0.5)).toBe(0);
  });
});
