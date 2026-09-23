import { describe, expect, it } from "vitest";
import { CUE_EVENTS } from "./events";
import { CUE_RECIPES, recipeLength, renderRecipe } from "./synth";
import { CUSTOM_SOUND_MAX_BYTES, validateCustomSound } from "./customSounds";

describe("built-in cue recipes", () => {
  it("has a short, audible recipe for every event", () => {
    for (const e of CUE_EVENTS) {
      const notes = CUE_RECIPES[e];
      expect(notes.length, e).toBeGreaterThan(0);
      expect(recipeLength(notes), e).toBeLessThanOrEqual(0.7);
      for (const n of notes) {
        expect(n.freq).toBeGreaterThanOrEqual(200);
        expect(n.freq).toBeLessThanOrEqual(2000);
        expect(n.gain ?? 1).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives on/off pairs different sounds", () => {
    expect(CUE_RECIPES.micMuted).not.toEqual(CUE_RECIPES.micUnmuted);
    expect(CUE_RECIPES.channelUserJoined).not.toEqual(CUE_RECIPES.channelUserLeft);
  });
});

describe("renderRecipe", () => {
  it("schedules one enveloped oscillator per note and returns the end time", () => {
    const started: number[] = [];
    const param = () => ({
      setValueAtTime() {},
      exponentialRampToValueAtTime() {},
    });
    const node = () => ({ connect: (n: unknown) => n, disconnect() {} });
    const ctx = {
      createOscillator: () => ({
        ...node(),
        type: "sine",
        frequency: param(),
        start: (t: number) => started.push(t),
        stop() {},
        onended: null,
      }),
      createGain: () => ({ ...node(), gain: param() }),
    };
    const notes = CUE_RECIPES.connected;
    const end = renderRecipe(ctx as never, {} as never, notes, 1, 0.5);
    expect(started).toEqual(notes.map((n) => 1 + n.at));
    expect(end).toBeCloseTo(1 + recipeLength(notes));
  });
});

describe("validateCustomSound", () => {
  it("accepts small audio files", () => {
    expect(validateCustomSound({ size: 1000, type: "audio/ogg" })).toBeNull();
    // Unlabelled files are left to the decoder.
    expect(validateCustomSound({ size: 1000, type: "" })).toBeNull();
  });

  it("rejects big or non-audio files", () => {
    expect(validateCustomSound({ size: CUSTOM_SOUND_MAX_BYTES + 1, type: "audio/wav" })).toBe(
      "too-large",
    );
    expect(validateCustomSound({ size: 10, type: "image/png" })).toBe("bad-type");
  });
});
