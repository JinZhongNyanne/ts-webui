/**
 * Runs the real capture worklet (public/worklets/capture.js) outside a
 * browser, like mixer-worklet.test.ts: the AudioWorklet globals are stubbed
 * and `process` is driven by hand, one 128-sample block at a time.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

interface Posted {
  pcm: Float32Array;
  rms: number;
  fx: boolean;
}

interface Capture {
  port: { onmessage: ((ev: { data: unknown }) => void) | null; posted: Posted[] };
  process(inputs: Float32Array[][]): boolean;
}

let CaptureClass: new (options: unknown) => Capture;

beforeAll(() => {
  const source = readFileSync(
    fileURLToPath(new URL("../../public/worklets/capture.js", import.meta.url)),
    "utf8",
  );
  class Processor {
    port = {
      onmessage: null,
      posted: [] as Posted[],
      postMessage(msg: Posted) {
        this.posted.push(msg);
      },
    };
  }
  const register = (_name: string, cls: new (options: unknown) => Capture) => (CaptureClass = cls);
  new Function("AudioWorkletProcessor", "registerProcessor", "sampleRate", source)(
    Processor,
    register,
    48_000,
  );
});

const FRAME = 256; // two blocks, to keep the tests short
const make = () => new CaptureClass({ processorOptions: { frameSize: FRAME } });
const channel = (level: number) => new Float32Array(128).fill(level);

/** Feeds two blocks: `mic` and `fx` are levels per block, or null for "nothing connected". */
function frame(capture: Capture, mic: number | null, fx: number | null): Posted | undefined {
  const before = capture.port.posted.length;
  for (let i = 0; i < 2; i++) {
    const inputs = [
      mic === null ? [] : [channel(mic)],
      fx === null ? [] : [channel(fx), channel(fx)],
    ];
    capture.process(inputs);
  }
  return capture.port.posted.length > before ? capture.port.posted.at(-1) : undefined;
}

describe("capture worklet", () => {
  it("frames the microphone as before when no clip is playing", () => {
    const posted = frame(make(), 0.25, null)!;
    expect(posted.pcm).toHaveLength(FRAME);
    expect(posted.pcm[0]).toBeCloseTo(0.25);
    expect(posted.rms).toBeCloseTo(0.25);
    expect(posted.fx).toBe(false);
  });

  it("mixes a clip into what is sent, but measures the microphone alone", () => {
    const posted = frame(make(), 0.25, 0.5)!;
    expect(posted.pcm[0]).toBeCloseTo(0.75);
    expect(posted.rms).toBeCloseTo(0.25);
    expect(posted.fx).toBe(true);
  });

  it("sends a clip with no microphone at all", () => {
    const posted = frame(make(), null, 0.5)!;
    expect(posted.pcm[FRAME - 1]).toBeCloseTo(0.5);
    expect(posted.rms).toBe(0);
    expect(posted.fx).toBe(true);
  });

  it("clamps the mix instead of wrapping past full scale", () => {
    const posted = frame(make(), 0.8, 0.9)!;
    expect(Math.max(...posted.pcm)).toBeLessThanOrEqual(1);
  });

  it("posts nothing while neither input has a source", () => {
    expect(frame(make(), null, null)).toBeUndefined();
  });

  it("marks only the frames a clip was in", () => {
    const capture = make();
    expect(frame(capture, 0.1, 0.1)!.fx).toBe(true);
    expect(frame(capture, 0.1, null)!.fx).toBe(false);
  });

  it("stays quiet while disabled", () => {
    const capture = make();
    capture.port.onmessage?.({ data: { enabled: false } });
    expect(frame(capture, 0.3, 0.3)).toBeUndefined();
  });
});
