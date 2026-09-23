/**
 * The transmit gate: whether a captured 20 ms frame is encoded and sent.
 *
 * Pure, so the rules can be tested without an AudioContext. The engine keeps
 * the timers and feeds every frame through `stepGate`.
 *
 * - Mic mute wins over everything.
 * - The whisper key, while held, opens the gate and sends everything (clips
 *   too) to the whisper targets instead of the channel. Whispering is judged
 *   by the server's whisper power, so it is not held back by talk power.
 * - Without talk power in this channel nothing goes to the channel at all:
 *   the server would drop it, and the speaking indicator would lie.
 * - Voice activation opens on a frame at or above the threshold and holds for
 *   HANGOVER_MS, so word endings are not clipped.
 * - Push to talk follows the key.
 * - A soundboard clip on the way out forces the gate open in either mode, for
 *   as long as it plays plus the same hangover, so the clip's quiet tail is
 *   sent too and the far side hears one transmission, not a stutter.
 */

export interface GateSettings {
  mode: "vad" | "ptt";
  threshold: number;
  pttPressed: boolean;
  /** The whisper hold-key is down. */
  whisperPressed: boolean;
  /** We have the talk power our channel asks for (see talk-power.ts). */
  canTalk: boolean;
}

/** Where an open gate sends frames. */
export type GateRoute = "channel" | "whisper";

export interface GateTimers {
  /** Voice activation holds open until then (performance.now() ms). */
  readonly vadUntil: number;
  /** A soundboard clip holds the gate open until then. */
  readonly clipUntil: number;
}

export interface GateFrame {
  /** Loudness of the microphone alone. */
  rms: number;
  /** A soundboard clip was mixed into this frame. */
  clip: boolean;
  now: number;
  transmitMuted: boolean;
}

export const HANGOVER_MS = 400;

export const CLOSED_GATE: GateTimers = { vadUntil: 0, clipUntil: 0 };

/** Where a frame would go right now, or null while the gate is shut. */
export function gateRoute(
  settings: GateSettings,
  timers: GateTimers,
  now: number,
  transmitMuted: boolean,
): GateRoute | null {
  if (transmitMuted) return null;
  if (settings.whisperPressed) return "whisper";
  if (!settings.canTalk) return null;
  if (now < timers.clipUntil) return "channel";
  if (settings.mode === "ptt") return settings.pttPressed ? "channel" : null;
  return now < timers.vadUntil ? "channel" : null;
}

/** Whether the gate is open right now, without a new frame (after a settings change). */
export function gateIsOpen(
  settings: GateSettings,
  timers: GateTimers,
  now: number,
  transmitMuted: boolean,
): boolean {
  return gateRoute(settings, timers, now, transmitMuted) !== null;
}

/** Feeds one frame through the gate: whether to send it, where, and the timers after it. */
export function stepGate(
  settings: GateSettings,
  timers: GateTimers,
  frame: GateFrame,
): { open: boolean; whisper: boolean; timers: GateTimers } {
  const { now } = frame;
  const loud = settings.mode === "vad" && frame.rms >= settings.threshold;
  const next: GateTimers = {
    // Push to talk keeps no voice-activation hangover to leak into a later switch.
    vadUntil: settings.mode !== "vad" ? 0 : loud ? now + HANGOVER_MS : timers.vadUntil,
    clipUntil: frame.clip ? now + HANGOVER_MS : timers.clipUntil,
  };
  const route = gateRoute(settings, next, now, frame.transmitMuted);
  return { open: route !== null, whisper: route === "whisper", timers: next };
}
