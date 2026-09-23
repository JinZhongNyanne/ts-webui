import { describe, expect, it, vi } from "vitest";
import {
  clampVolume,
  playClip,
  speakUtterance,
  type AudioLike,
  type UtteranceLike,
} from "./playback";

function fakeAudio(): AudioLike & { paused: boolean } {
  return {
    volume: 1,
    paused: false,
    onended: null,
    onerror: null,
    play: () => Promise.resolve(),
    pause() {
      this.paused = true;
    },
  };
}

const settled = async (p: Promise<void>) => {
  let state = "pending";
  p.then(
    () => (state = "resolved"),
    () => (state = "rejected"),
  );
  await Promise.resolve();
  await Promise.resolve();
  return state;
};

describe("clampVolume", () => {
  it("keeps the volume in 0..1", () => {
    expect(clampVolume(1.5)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(0.4)).toBe(0.4);
  });
});

describe("playClip", () => {
  it("resolves when the clip ends", async () => {
    const a = fakeAudio();
    const p = playClip(a, 0.5, () => new Error("x"));
    expect(a.volume).toBe(0.5);
    a.onended!();
    await expect(p.done).resolves.toBeUndefined();
  });

  it("stops the clip and still settles when cancelled", async () => {
    const a = fakeAudio();
    const p = playClip(a, 0.5, () => new Error("x"));
    p.cancel();
    expect(a.paused).toBe(true);
    expect(await settled(p.done)).toBe("resolved");
  });

  it("changes the volume of the playing clip", () => {
    const a = fakeAudio();
    const p = playClip(a, 0.8, () => new Error("x"));
    p.setVolume(0.1);
    expect(a.volume).toBe(0.1);
  });

  it("rejects on a load error", async () => {
    const a = fakeAudio();
    const p = playClip(a, 1, () => new Error("edge failed"));
    a.onerror!();
    await expect(p.done).rejects.toThrow("edge failed");
  });

  it("rejects when the browser refuses to play", async () => {
    const a = { ...fakeAudio(), play: () => Promise.reject(new Error("autoplay")) };
    const p = playClip(a, 1, () => new Error("x"));
    await expect(p.done).rejects.toThrow("autoplay");
  });
});

function fakeSynth() {
  const spoken: UtteranceLike[] = [];
  const synth = {
    speak: (u: UtteranceLike) => void spoken.push(u),
    // A real browser reports "interrupted" to whatever it was speaking.
    cancel: vi.fn(() => {
      for (const u of spoken) u.onerror?.({ error: "interrupted" });
    }),
  };
  const make = (): UtteranceLike => ({ volume: 1, onend: null, onerror: null });
  return { synth, spoken, make };
}

describe("speakUtterance", () => {
  it("resolves when the phrase ends", async () => {
    const { synth, spoken, make } = fakeSynth();
    const p = speakUtterance(synth, make, 0.6, (r) => new Error(r));
    expect(spoken[0]!.volume).toBe(0.6);
    spoken[0]!.onend!();
    await expect(p.done).resolves.toBeUndefined();
  });

  it("cancels speech and settles without an error", async () => {
    const { synth, make } = fakeSynth();
    const p = speakUtterance(synth, make, 1, (r) => new Error(r));
    p.cancel();
    expect(synth.cancel).toHaveBeenCalled();
    expect(await settled(p.done)).toBe("resolved");
  });

  it("says which engine restarts on a volume change", () => {
    const { synth, make } = fakeSynth();
    expect(speakUtterance(synth, make, 1, (r) => new Error(r)).restartsOnVolume).toBe(true);
    expect(playClip(fakeAudio(), 1, () => new Error("x")).restartsOnVolume).toBe(false);
  });

  it("re-speaks the phrase at the new volume, a tick after the cancel", async () => {
    const { synth, spoken, make } = fakeSynth();
    const p = speakUtterance(synth, make, 1, (r) => new Error(r));
    p.setVolume(0.2);
    // Some engines drop a speak() issued in the same tick as cancel().
    expect(spoken).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(spoken).toHaveLength(2);
    expect(spoken[1]!.volume).toBe(0.2);
    // The first utterance's "interrupted" must not end the phrase.
    expect(await settled(p.done)).toBe("pending");
    spoken[1]!.onend!();
    expect(await settled(p.done)).toBe("resolved");
  });

  it("does not restart a phrase cancelled before the re-speak", async () => {
    const { synth, spoken, make } = fakeSynth();
    const p = speakUtterance(synth, make, 1, (r) => new Error(r));
    p.setVolume(0.2);
    p.cancel();
    await new Promise((r) => setTimeout(r, 0));
    expect(spoken).toHaveLength(1);
    expect(await settled(p.done)).toBe("resolved");
  });

  it("rejects on a real synthesis error", async () => {
    const { synth, spoken, make } = fakeSynth();
    const p = speakUtterance(synth, make, 1, (r) => new Error(`synth: ${r}`));
    spoken[0]!.onerror!({ error: "network" });
    await expect(p.done).rejects.toThrow("synth: network");
  });
});
