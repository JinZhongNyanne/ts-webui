/**
 * Built-in cue sounds, synthesized with WebAudio instead of shipped as files:
 * TeamSpeak's own sound pack is not ours to redistribute, and a few oscillator
 * notes cost nothing to download.
 *
 * The design is deliberately small: soft sine/triangle notes with a short
 * attack and an exponential tail, so nothing clicks or blares. Families share a
 * shape — "on / arrived" rises, "off / gone" falls — so the cues are learnable
 * without looking.
 */
import type { CueEvent } from "./events";

export interface Note {
  /** Hz. */
  freq: number;
  /** Seconds after the cue starts. */
  at: number;
  /** Seconds, including the tail. */
  dur: number;
  /** Peak level relative to the cue volume (0..1). */
  gain?: number;
  type?: "sine" | "triangle";
  /** Glide to this frequency over the note (Hz). */
  glideTo?: number;
}

/* Equal-tempered pitches used below. */
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880;
const B5 = 987.77;
const C6 = 1046.5;
const D6 = 1174.66;
const E6 = 1318.51;
const G4 = 392;
const A4 = 440;
const E4 = 329.63;
const C4 = 261.63;
const D4 = 293.66;
const A3 = 220;

const rise = (a: number, b: number, type: Note["type"] = "sine"): Note[] => [
  { freq: a, at: 0, dur: 0.12, type },
  { freq: b, at: 0.08, dur: 0.18, type },
];
const fall = (a: number, b: number, type: Note["type"] = "sine"): Note[] => [
  { freq: a, at: 0, dur: 0.12, type },
  { freq: b, at: 0.08, dur: 0.2, type },
];

export const CUE_RECIPES: Record<CueEvent, Note[]> = {
  connected: [
    { freq: C5, at: 0, dur: 0.14 },
    { freq: E5, at: 0.09, dur: 0.14 },
    { freq: G5, at: 0.18, dur: 0.3 },
  ],
  disconnected: [
    { freq: G5, at: 0, dur: 0.14 },
    { freq: E5, at: 0.09, dur: 0.14 },
    { freq: C5, at: 0.18, dur: 0.3 },
  ],
  connectionLost: [
    { freq: A4, at: 0, dur: 0.22, type: "triangle", gain: 0.9 },
    { freq: E4, at: 0.2, dur: 0.4, type: "triangle", gain: 0.9 },
  ],
  kickedFromServer: [
    { freq: E4, at: 0, dur: 0.12, type: "triangle" },
    { freq: E4, at: 0.14, dur: 0.12, type: "triangle" },
    { freq: C4, at: 0.28, dur: 0.4, type: "triangle" },
  ],
  // The kick cue's figure, a step lower and ending lower still.
  banned: [
    { freq: D4, at: 0, dur: 0.12, type: "triangle" },
    { freq: D4, at: 0.14, dur: 0.12, type: "triangle" },
    { freq: A3, at: 0.28, dur: 0.42, type: "triangle" },
  ],
  channelUserJoined: rise(E5, A5),
  channelUserLeft: fall(A5, E5),
  serverUserJoined: [{ freq: B5, at: 0, dur: 0.12, gain: 0.6 }],
  serverUserLeft: [{ freq: G5, at: 0, dur: 0.12, gain: 0.6 }],
  whisperReceived: [
    { freq: A5, at: 0, dur: 0.08, gain: 0.5 },
    { freq: E5, at: 0.09, dur: 0.16, gain: 0.5 },
  ],
  movedByOther: [{ freq: D5, at: 0, dur: 0.3, glideTo: A5 }],
  kickedFromChannel: [
    { freq: A4, at: 0, dur: 0.14, type: "triangle" },
    { freq: G4, at: 0.14, dur: 0.3, type: "triangle" },
  ],
  talkPowerGranted: rise(C5, G5),
  talkPowerRevoked: fall(G5, C5),
  poked: [
    { freq: E6, at: 0, dur: 0.09 },
    { freq: E6, at: 0.12, dur: 0.09 },
    { freq: C6, at: 0.24, dur: 0.22 },
  ],
  privateMessage: [
    { freq: G5, at: 0, dur: 0.14 },
    { freq: D6, at: 0.1, dur: 0.28 },
  ],
  channelMessage: [{ freq: A5, at: 0, dur: 0.14, gain: 0.7 }],
  serverMessage: [{ freq: D5, at: 0, dur: 0.14, gain: 0.7 }],
  micMuted: fall(D5, A4, "triangle"),
  micUnmuted: rise(A4, D5, "triangle"),
  speakersMuted: fall(G5, D5),
  speakersUnmuted: rise(D5, G5),
  awayOn: [{ freq: E5, at: 0, dur: 0.35, glideTo: C5, gain: 0.7 }],
  awayOff: [{ freq: C5, at: 0, dur: 0.35, glideTo: E5, gain: 0.7 }],
};

/** Attack time: long enough not to click, short enough to feel immediate. */
const ATTACK_S = 0.008;
/** Exponential ramps cannot reach zero; this is inaudible. */
const SILENT = 0.0001;

/** Seconds from the first note's start to the last note's end. */
export function recipeLength(notes: readonly Note[]): number {
  return notes.reduce((end, n) => Math.max(end, n.at + n.dur), 0);
}

/**
 * Schedules a recipe on `dest` starting at `when` (context time). Returns the
 * time it ends, so the caller knows when the nodes can be let go.
 */
export function renderRecipe(
  ctx: BaseAudioContext,
  dest: AudioNode,
  notes: readonly Note[],
  when: number,
  volume: number,
): number {
  for (const n of notes) {
    const start = when + n.at;
    const end = start + n.dur;
    const peak = Math.max(SILENT, volume * (n.gain ?? 1));
    const osc = ctx.createOscillator();
    osc.type = n.type ?? "sine";
    osc.frequency.setValueAtTime(n.freq, start);
    if (n.glideTo) osc.frequency.exponentialRampToValueAtTime(n.glideTo, end);
    const env = ctx.createGain();
    env.gain.setValueAtTime(SILENT, start);
    env.gain.exponentialRampToValueAtTime(peak, start + ATTACK_S);
    env.gain.exponentialRampToValueAtTime(SILENT, end);
    osc.connect(env).connect(dest);
    osc.start(start);
    osc.stop(end + 0.02);
    osc.onended = () => env.disconnect();
  }
  return when + recipeLength(notes);
}
