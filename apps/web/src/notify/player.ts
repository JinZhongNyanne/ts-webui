/**
 * Plays cue sounds. It owns a small AudioContext of its own rather than
 * borrowing the voice engine's: cues must work before voice was ever started
 * (the "connected" chime plays first thing) and must not go through the voice
 * mixer's auto-level and limiter, which are tuned for speech. It follows the
 * same output device as voice, via `setSinkId`, where the browser has it.
 */
import type { CueEvent } from "./events";
import { CUE_RECIPES, renderRecipe } from "./synth";

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> };

/** A little lead time so the first note's envelope is scheduled in the future. */
const START_DELAY_S = 0.01;
/** Some browsers leave `resume()` pending instead of rejecting; a cue is not worth waiting on. */
const RESUME_TIMEOUT_MS = 300;

export class CuePlayer {
  private ctx: SinkContext | null = null;
  private sinkId = "";
  private readonly custom = new Map<CueEvent, AudioBuffer>();
  /** Undecoded custom sounds; decoded on first use (decoding needs a context). */
  private readonly pending = new Map<CueEvent, Blob>();

  /** Output device id; "" = system default. */
  async setSink(deviceId: string): Promise<void> {
    this.sinkId = deviceId;
    if (this.ctx?.setSinkId) await this.ctx.setSinkId(deviceId).catch(() => undefined);
  }

  setCustom(event: CueEvent, blob: Blob | null): void {
    this.custom.delete(event);
    this.pending.delete(event);
    if (blob) this.pending.set(event, blob);
  }

  /**
   * Plays a cue: the user's own sound for it if one was set and decodes, the
   * built-in synth otherwise. Never throws — a cue that cannot play (no
   * gesture yet, broken file) is simply not heard.
   */
  async play(event: CueEvent, volume: number): Promise<void> {
    const ctx = await this.context();
    if (!ctx) return;
    const when = ctx.currentTime + START_DELAY_S;
    const buffer = await this.customBuffer(ctx, event);
    if (buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(ctx.destination);
      src.onended = () => gain.disconnect();
      src.start(when);
      return;
    }
    renderRecipe(ctx, ctx.destination, CUE_RECIPES[event], when, volume);
  }

  /** Decodes a custom sound now, so an unplayable upload is reported right away. */
  async check(blob: Blob): Promise<boolean> {
    const ctx = await this.context();
    if (!ctx) return true; // cannot tell yet; it will fall back to the synth if broken
    try {
      await ctx.decodeAudioData(await blob.arrayBuffer());
      return true;
    } catch {
      return false;
    }
  }

  private async customBuffer(ctx: AudioContext, event: CueEvent): Promise<AudioBuffer | null> {
    const ready = this.custom.get(event);
    if (ready) return ready;
    const blob = this.pending.get(event);
    if (!blob) return null;
    try {
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      // A newer upload may have replaced the blob while this one decoded.
      if (this.pending.get(event) === blob) {
        this.pending.delete(event);
        this.custom.set(event, buffer);
      }
      return buffer;
    } catch {
      return null;
    }
  }

  private async context(): Promise<AudioContext | null> {
    if (typeof AudioContext === "undefined") return null;
    // Before the first click the browser would refuse to start audio anyway
    // (and `resume()` would hang until one came), so don't try.
    const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } })
      .userActivation;
    if (activation && !activation.hasBeenActive) return null;
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: "interactive" }) as SinkContext;
      if (this.sinkId && this.ctx.setSinkId) {
        await this.ctx.setSinkId(this.sinkId).catch(() => undefined);
      }
    }
    // Created before any user gesture the context starts suspended; once the
    // page has been clicked (connecting counts) resuming succeeds.
    if (this.ctx.state === "suspended") {
      const settle = new Promise<void>((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS));
      await Promise.race([this.ctx.resume().catch(() => undefined), settle]);
    }
    return this.ctx.state === "running" ? this.ctx : null;
  }
}
