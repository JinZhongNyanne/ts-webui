import { describe, expect, it } from "vitest";
import {
  CLOSED_GATE,
  HANGOVER_MS,
  gateIsOpen,
  gateRoute,
  stepGate,
  type GateSettings,
} from "./gate";

const base = { threshold: 0.1, pttPressed: false, whisperPressed: false, canTalk: true };
const vad: GateSettings = { ...base, mode: "vad" };
const ptt: GateSettings = { ...base, mode: "ptt" };
const frame = (over: Partial<Parameters<typeof stepGate>[2]> = {}) => ({
  rms: 0,
  clip: false,
  now: 1000,
  transmitMuted: false,
  ...over,
});

describe("voice activation", () => {
  it("opens on a loud frame and holds for the hangover", () => {
    const loud = stepGate(vad, CLOSED_GATE, frame({ rms: 0.2 }));
    expect(loud.open).toBe(true);
    expect(stepGate(vad, loud.timers, frame({ now: 1000 + HANGOVER_MS - 1 })).open).toBe(true);
    expect(stepGate(vad, loud.timers, frame({ now: 1000 + HANGOVER_MS })).open).toBe(false);
  });

  it("stays shut for quiet frames", () =>
    expect(stepGate(vad, CLOSED_GATE, frame()).open).toBe(false));
});

describe("push to talk", () => {
  it("follows the key, whatever the level", () => {
    expect(stepGate(ptt, CLOSED_GATE, frame({ rms: 1 })).open).toBe(false);
    expect(stepGate({ ...ptt, pttPressed: true }, CLOSED_GATE, frame()).open).toBe(true);
  });

  it("does not inherit a voice-activation hangover", () => {
    const loud = stepGate(vad, CLOSED_GATE, frame({ rms: 0.5 }));
    expect(stepGate(ptt, loud.timers, frame({ now: 1100 })).open).toBe(false);
  });
});

describe("soundboard clips", () => {
  it.each([
    ["voice activation", vad],
    ["push to talk", ptt],
  ])("force the gate open in %s, plus the hangover after", (_label, settings) => {
    const playing = stepGate(settings, CLOSED_GATE, frame({ clip: true }));
    expect(playing.open).toBe(true);
    const after = stepGate(settings, playing.timers, frame({ now: 1000 + HANGOVER_MS - 1 }));
    expect(after.open).toBe(true);
    expect(stepGate(settings, after.timers, frame({ now: 1000 + HANGOVER_MS })).open).toBe(false);
  });

  it("never open a muted microphone", () => {
    const result = stepGate({ ...ptt, pttPressed: true }, CLOSED_GATE, {
      ...frame({ clip: true, rms: 1 }),
      transmitMuted: true,
    });
    expect(result.open).toBe(false);
  });
});

describe("gateIsOpen", () => {
  it("peeks without a frame, for settings changes", () => {
    const playing = stepGate(ptt, CLOSED_GATE, frame({ clip: true }));
    expect(gateIsOpen(ptt, playing.timers, 1100, false)).toBe(true);
    expect(gateIsOpen(ptt, playing.timers, 1100, true)).toBe(false);
    expect(gateIsOpen(vad, CLOSED_GATE, 1100, false)).toBe(false);
    expect(gateIsOpen({ ...ptt, pttPressed: true }, CLOSED_GATE, 0, false)).toBe(true);
  });
});

describe("talk power", () => {
  const silenced = (s: GateSettings): GateSettings => ({ ...s, canTalk: false });

  it("keeps the gate shut however loud, in either mode", () => {
    expect(stepGate(silenced(vad), CLOSED_GATE, frame({ rms: 1 })).open).toBe(false);
    expect(
      stepGate(silenced({ ...ptt, pttPressed: true }), CLOSED_GATE, frame({ rms: 1 })).open,
    ).toBe(false);
  });

  it("does not let a soundboard clip through either", () => {
    expect(stepGate(silenced(ptt), CLOSED_GATE, frame({ clip: true })).open).toBe(false);
  });

  it("still lets a whisper through: whispering needs whisper power, not talk power", () => {
    const whispering = silenced({ ...vad, whisperPressed: true });
    const step = stepGate(whispering, CLOSED_GATE, frame());
    expect(step.open).toBe(true);
    expect(step.whisper).toBe(true);
  });
});

describe("whisper", () => {
  it("opens while the whisper key is held, whatever the mode or level", () => {
    for (const s of [vad, ptt]) {
      const step = stepGate({ ...s, whisperPressed: true }, CLOSED_GATE, frame());
      expect(step).toMatchObject({ open: true, whisper: true });
    }
  });

  it("routes everything to the whisper while held, even with push to talk down too", () => {
    const both = { ...ptt, pttPressed: true, whisperPressed: true };
    expect(stepGate(both, CLOSED_GATE, frame({ clip: true })).whisper).toBe(true);
  });

  it("goes back to the channel on release", () => {
    const step = stepGate({ ...ptt, pttPressed: true }, CLOSED_GATE, frame());
    expect(step).toMatchObject({ open: true, whisper: false });
  });

  it("never opens a muted microphone", () => {
    const step = stepGate({ ...vad, whisperPressed: true }, CLOSED_GATE, {
      ...frame(),
      transmitMuted: true,
    });
    expect(step.open).toBe(false);
  });
});

describe("gateRoute", () => {
  it("names where the next frame goes, or null when nowhere", () => {
    expect(gateRoute(vad, CLOSED_GATE, 0, false)).toBeNull();
    expect(gateRoute({ ...ptt, pttPressed: true }, CLOSED_GATE, 0, false)).toBe("channel");
    expect(gateRoute({ ...ptt, whisperPressed: true }, CLOSED_GATE, 0, false)).toBe("whisper");
    expect(gateRoute({ ...ptt, whisperPressed: true }, CLOSED_GATE, 0, true)).toBeNull();
  });
});
