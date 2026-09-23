/**
 * One phrase being spoken, as a handle the TTS store can stop or re-volume
 * while it plays.
 *
 * Both engines settle `done` exactly once — including when cancelled — so the
 * store's queue never waits on a clip that was paused and will never end.
 *
 * The browser engine cannot change the volume of an utterance already queued
 * with `speechSynthesis`; the only way to make a new volume heard right away is
 * to cancel it and speak the phrase again at the new level.
 *
 * The DOM objects are injected, so this runs under a plain Node test.
 */

export interface Playback {
  /** Settles when the phrase ends, fails, or is cancelled. */
  done: Promise<void>;
  cancel(): void;
  setVolume(volume: number): void;
  /** True when a volume change starts the phrase over (the browser engine). */
  readonly restartsOnVolume: boolean;
}

export const clampVolume = (v: number): number =>
  Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;

/** The bits of `HTMLAudioElement` used here. */
export interface AudioLike {
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  play(): Promise<void>;
  pause(): void;
}

export function playClip(audio: AudioLike, volume: number, failure: () => Error): Playback {
  let settle!: { resolve: () => void; reject: (e: unknown) => void };
  let finished = false;
  const done = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  const finish = (err?: unknown) => {
    if (finished) return;
    finished = true;
    audio.onended = null;
    audio.onerror = null;
    if (err === undefined) settle.resolve();
    else settle.reject(err);
  };
  audio.volume = clampVolume(volume);
  audio.onended = () => finish();
  audio.onerror = () => finish(failure());
  audio.play().catch((err: unknown) => finish(err ?? failure()));
  return {
    done,
    restartsOnVolume: false,
    cancel() {
      if (finished) return;
      audio.pause();
      finish();
    },
    setVolume(v) {
      if (!finished) audio.volume = clampVolume(v);
    },
  };
}

/** The bits of `SpeechSynthesisUtterance` used here. */
export interface UtteranceLike {
  volume: number;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
}

/** Errors the browser raises for an utterance we cancelled ourselves. */
const CANCEL_ERRORS = new Set(["interrupted", "canceled"]);

export function speakUtterance(
  synth: SynthLike,
  makeUtterance: () => UtteranceLike,
  volume: number,
  failure: (reason: string) => Error,
): Playback {
  let settle!: { resolve: () => void; reject: (e: unknown) => void };
  let finished = false;
  const done = new Promise<void>((resolve, reject) => (settle = { resolve, reject }));
  let current: UtteranceLike | null = null;

  const finish = (err?: Error) => {
    if (finished) return;
    finished = true;
    if (current) current.onend = current.onerror = null;
    current = null;
    if (err) settle.reject(err);
    else settle.resolve();
  };

  const start = (v: number) => {
    const u = makeUtterance();
    u.volume = clampVolume(v);
    // Handlers check identity: a restarted phrase's old utterance still fires.
    u.onend = () => current === u && finish();
    u.onerror = (e) => {
      if (current !== u) return;
      if (CANCEL_ERRORS.has(e.error)) finish();
      else finish(failure(e.error));
    };
    current = u;
    synth.speak(u);
  };

  start(volume);
  return {
    done,
    restartsOnVolume: true,
    cancel() {
      if (finished) return;
      finish();
      synth.cancel();
    },
    setVolume(v) {
      if (finished) return;
      // Detach the old utterance first so its "interrupted" is not a failure.
      current = null;
      synth.cancel();
      // Chromium can drop a speak() issued in the same tick as cancel(), which
      // would leave `done` pending forever; speak on the next one instead.
      setTimeout(() => {
        if (!finished) start(v);
      }, 0);
    },
  };
}
