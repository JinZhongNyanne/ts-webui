/**
 * VoiceEngine: microphone -> Opus -> hub, and hub -> Opus -> mixer -> speakers.
 *
 * Owns the AudioContext and both worklets. Codec follows the current channel.
 *
 * The send path (capture worklet + Opus encoder) has two inputs: the
 * microphone and the soundboard bus. It is built for whichever needs it first
 * and torn down once neither does, so a soundboard clip reaches the channel
 * even for someone who never turned their microphone on.
 */
import type { VoiceFrame } from "@jinz/protocol";
import { Codec, isOpusCodec, isWhisperKind, VoiceFrameKind } from "@jinz/protocol";
import type { HubConnection } from "../ts/connection";
import { t } from "../i18n";
import {
  canEncodeOpus,
  createOpusDecoder,
  createOpusEncoder,
  FRAME_SAMPLES,
  SAMPLE_RATE,
  type OpusDecoderLike,
  type OpusEncoderLike,
} from "./opus";
import {
  appliedFrom,
  DEFAULT_PROCESSING,
  micConstraints,
  needsNewTrack,
  type AppliedProcessing,
  type MicProcessing,
} from "./processing";
import type { DenoiseNode } from "./denoise";
import {
  CLOSED_GATE,
  gateRoute,
  stepGate,
  type GateRoute,
  type GateSettings,
  type GateTimers,
} from "./gate";
import { createEncodeQueue, type EncodeQueue } from "./encode-queue";
import { createLatestBuilds } from "./latest-build";

export interface ClientMeter {
  /** Current block loudness in dBFS (-180 when silent). */
  rmsDb: number;
  /** Average speech loudness over the last ~30 s, or null until enough speech was heard. */
  avgDb: number | null;
  /** Gain the auto-leveller is currently applying, in dB. */
  autoGainDb: number;
}

export interface MasterMeter {
  peakDb: number;
  /** Limiter gain reduction in dB (0 = not limiting). */
  reductionDb: number;
}

export interface VoiceEngineCallbacks {
  onRemoteTalking: (clientId: number, talking: boolean) => void;
  /** `whisper`: what we are sending goes to the whisper targets, not the channel. */
  onSelfTalking: (talking: boolean, whisper: boolean) => void;
  /** Someone started or stopped whispering to us (only while whispers are allowed). */
  onRemoteWhisper?: (clientId: number, whispering: boolean) => void;
  onLevel: (rms: number) => void;
  onMeter?: (clients: Record<string, ClientMeter>, master: MasterMeter) => void;
  onError: (message: string) => void;
  /** What the browser really applied to a freshly opened mic track. */
  onMicProcessing?: (applied: AppliedProcessing) => void;
}

export type GateState = GateSettings;

/** How a soundboard clip is played; `gain` is linear (1 = as recorded). */
export interface ClipOptions {
  gain: number;
  /** Through our own speakers (the mixer's effects input). */
  local: boolean;
  /** Into the channel, mixed into what the microphone sends. */
  voice: boolean;
}

export interface ClipHandle {
  /** Stops the clip now; harmless once it has ended. */
  stop(): void;
  /** Settles when the clip ends, however that happens. */
  readonly ended: Promise<void>;
}

interface ActiveClip {
  readonly voice: boolean;
  stop(): void;
}

/** The capture worklet's two inputs. */
const MIC_INPUT = 0;
const CLIP_INPUT = 1;

export class VoiceEngine {
  private ctx: AudioContext | null = null;
  private mixer: AudioWorkletNode | null = null;
  private capture: AudioWorkletNode | null = null;
  /** Resolves once the capture node and its encoder are ready; null while there is no send path. */
  private sendPath: Promise<AudioWorkletNode> | null = null;
  /** Soundboard clips playing now, locally, into the channel or both. */
  private readonly clips = new Set<ActiveClip>();
  private micSource: MediaStreamAudioSourceNode | null = null;
  /** Input volume, applied before the gate/encoder (output volume lives in the mixer). */
  private micGainNode: GainNode | null = null;
  private micGain = 1;
  private micStream: MediaStream | null = null;
  private micDeviceId: string | undefined;
  private processing: MicProcessing = { ...DEFAULT_PROCESSING };
  /** RNNoise stage between the mic source and the input gain, when enabled. */
  private denoise: DenoiseNode | null = null;
  /** Bumped per wireInput call, so a slow RNNoise load cannot wire over a newer one. */
  private wireGen = 0;
  /** The processing the live mic track was opened with (null = no mic). */
  private openedWith: MicProcessing | null = null;
  /** The RNNoise setting the input graph was last wired for. */
  private wiredRnnoise = false;
  /** Processing changes run one at a time, each against the latest settings. */
  private swapChain: Promise<void> = Promise.resolve();
  private encoder: OpusEncoderLike | null = null;
  /** Encoder builds overtaken by a newer one (or a teardown) are closed, never installed. */
  private readonly encoderBuilds = createLatestBuilds();
  private readonly decoders = new Map<number, { codec: number; dec: OpusDecoderLike }>();
  private unsubVoice: (() => void) | null = null;

  private codec: number = Codec.OpusVoice;
  private quality = 6;
  private gate: GateState = {
    mode: "vad",
    threshold: 0.02,
    pttPressed: false,
    whisperPressed: false,
    canTalk: true,
  };
  private gateTimers: GateTimers = CLOSED_GATE;
  /** Where the transmission in progress goes; null while not transmitting. */
  private talkRoute: GateRoute | null = null;
  /** Whispers to us are dropped unheard while set (the receive policy). */
  private blockWhispers = false;
  /**
   * The route of every frame handed to the encoder and not yet out of it,
   * with the end-of-talk markers owed between them (see encode-queue.ts for
   * why). Installed together with its encoder; null while there is none.
   */
  private encodeQueue: EncodeQueue | null = null;
  /** Clients whose latest frames to us were whispers. */
  private readonly whisperers = new Set<number>();
  private outputMuted = false;
  private transmitMuted = false;
  private started = false;
  canEncode = false;

  constructor(
    private readonly hub: HubConnection,
    private readonly cb: VoiceEngineCallbacks,
  ) {}

  get running(): boolean {
    return this.started;
  }

  get micEnabled(): boolean {
    return this.micStream !== null;
  }

  /** Must be called from a user gesture so the AudioContext may start. */
  async start(outputDeviceId?: string): Promise<void> {
    if (this.started) return;
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule("/worklets/mixer.js");
    await ctx.audioWorklet.addModule("/worklets/capture.js");
    const mixer = new AudioWorkletNode(ctx, "jinz-mixer", {
      // The effects bus (see playEffect); stereo, so a mono clip is up-mixed.
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    mixer.port.onmessage = (
      ev: MessageEvent<
        | { type: "level"; clientId: number; active: boolean }
        | { type: "meter"; clients: Record<string, ClientMeter>; master: MasterMeter }
      >,
    ) => {
      const d = ev.data;
      if (d?.type === "level") {
        if (!d.active) this.markWhisper(d.clientId, false);
        this.cb.onRemoteTalking(d.clientId, d.active);
      } else if (d?.type === "meter") this.cb.onMeter?.(d.clients, d.master);
    };
    mixer.connect(ctx.destination);
    this.mixer = mixer;
    if (outputDeviceId) await this.setOutputDevice(outputDeviceId);
    if (ctx.state !== "running") await ctx.resume().catch(() => undefined);

    this.canEncode = await canEncodeOpus();
    this.unsubVoice = this.hub.onVoice((frame) => this.onIncoming(frame));
    this.started = true;
  }

  async stop(): Promise<void> {
    this.unsubVoice?.();
    this.unsubVoice = null;
    this.stopClips();
    await this.disableMic();
    this.teardownSendPath();
    for (const { dec } of this.decoders.values()) dec.close();
    this.decoders.clear();
    this.mixer?.disconnect();
    this.mixer = null;
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.started = false;
  }

  /* ------------------------------- output -------------------------------- */

  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (!ctx?.setSinkId) return;
    try {
      await ctx.setSinkId(deviceId);
    } catch (err) {
      this.cb.onError(
        t("audio.errOutputDevice", { reason: err instanceof Error ? err.message : String(err) }),
      );
    }
  }

  /** Output volume: how loud everyone else is in our speakers. */
  setMasterVolume(value: number): void {
    this.mixer?.port.postMessage({ type: "master", value });
  }

  /** Input volume: how loud our microphone is sent to everyone else. */
  setMicVolume(value: number): void {
    this.micGain = value;
    if (this.micGainNode && this.ctx) {
      this.micGainNode.gain.setTargetAtTime(value, this.ctx.currentTime, 0.02);
    }
  }

  /** Normalize every speaker's 30-second loudness toward targetDb (RMS, dBFS). */
  setAutoLevel(on: boolean, targetDb: number): void {
    this.mixer?.port.postMessage({ type: "autolevel", on, targetDb });
  }

  /** Hearing protection: clamp output peaks above thresholdDb (dBFS). */
  setLimiter(on: boolean, thresholdDb: number): void {
    this.mixer?.port.postMessage({ type: "limiter", on, thresholdDb });
  }

  /**
   * Plays a sound clip through the mixer, so the master volume, speaker mute
   * and limiter apply to it as to voices, and it reaches the chosen output
   * device. Resolves false when it could not (engine stopped, fetch or decode
   * failed); the caller may then fall back to a plain <audio>.
   */
  async playEffect(url: string): Promise<boolean> {
    const ctx = this.ctx;
    const mixer = this.mixer;
    if (!ctx || !mixer) return false;
    try {
      const res = await fetch(url);
      if (!res.ok) return false;
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      if (this.mixer !== mixer) return false; // stopped while loading
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(mixer);
      source.onended = () => source.disconnect();
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Plays a soundboard clip: locally through the mixer's effects input (so
   * speaker mute, master volume and the limiter apply), into the channel
   * through the capture worklet's clip input, or both. Sending builds the
   * send path when the microphone is off, and holds the transmit gate open
   * while the clip plays (see gate.ts); mic mute still silences it.
   */
  async playClip(buffer: AudioBuffer, opts: ClipOptions): Promise<ClipHandle> {
    const ctx = this.ctx;
    const mixer = this.mixer;
    if (!ctx || !mixer) throw new Error(t("audio.errNotStarted"));
    const capture = opts.voice ? await this.ensureSendPath() : null;
    if (this.ctx !== ctx) throw new Error(t("audio.errNotStarted")); // stopped meanwhile

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const outputs: AudioNode[] = [];
    const branch = (): GainNode => {
      const gain = ctx.createGain();
      gain.gain.value = opts.gain;
      source.connect(gain);
      outputs.push(gain);
      return gain;
    };
    if (opts.local) branch().connect(mixer);
    if (capture) branch().connect(capture, 0, CLIP_INPUT);

    let resolveEnded: () => void = () => undefined;
    const ended = new Promise<void>((r) => (resolveEnded = r));
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      source.disconnect();
      for (const node of outputs) node.disconnect();
      this.clips.delete(clip);
      if (clip.voice) this.releaseSendPathIfIdle();
      resolveEnded();
    };
    const clip: ActiveClip = {
      voice: capture !== null,
      stop: () => {
        try {
          source.stop();
        } catch {
          /* never started or already stopped */
        }
        finish();
      },
    };
    source.onended = finish;
    this.clips.add(clip);
    source.start();
    return { stop: clip.stop, ended };
  }

  /** Stops every clip this page started. */
  stopClips(): void {
    for (const clip of [...this.clips]) clip.stop();
  }

  private sendingClips(): boolean {
    for (const clip of this.clips) if (clip.voice) return true;
    return false;
  }

  setClientGain(clientId: number, value: number): void {
    this.mixer?.port.postMessage({ type: "gain", clientId, value });
  }

  /** The receive policy: when set, whispers to us are neither played nor marked. */
  setBlockWhispers(block: boolean): void {
    this.blockWhispers = block;
    if (block) for (const id of [...this.whisperers]) this.markWhisper(id, false);
  }

  removeClient(clientId: number): void {
    this.markWhisper(clientId, false);
    const d = this.decoders.get(clientId);
    if (d) {
      d.dec.close();
      this.decoders.delete(clientId);
    }
    this.mixer?.port.postMessage({ type: "remove", clientId });
  }

  /**
   * Mic mute: nothing is encoded or sent while set, and an ongoing
   * transmission ends at once. The hub drops voice too; this keeps the
   * "talking" indicator and the upload honest.
   */
  setTransmitMuted(muted: boolean): void {
    this.transmitMuted = muted;
    if (muted) this.endTalk();
  }

  setOutputMuted(muted: boolean): void {
    this.outputMuted = muted;
    // Incoming frames stop being decoded, but the mixer still holds up to a few
    // hundred ms of jitter buffer: drop it so muting is heard immediately.
    this.mixer?.port.postMessage({ type: "mute", on: muted });
  }

  private onIncoming(frame: VoiceFrame): void {
    if (!this.started || !this.mixer) return;
    const whisper = isWhisperKind(frame.kind);
    if (whisper && this.blockWhispers) return;
    // Tracked even with the speakers muted, so the whisper cue still sounds
    // and the marker is right the moment they are unmuted. An empty frame
    // ends the transmission.
    this.markWhisper(frame.clientId, whisper && frame.payload.byteLength > 0);
    if (this.outputMuted) return;
    if (!isOpusCodec(frame.codec)) return; // Speex/CELT: cannot decode in the browser
    if (frame.payload.byteLength === 0) return; // end-of-talk marker
    let entry = this.decoders.get(frame.clientId);
    // A decoder that changed codec, errored or was closed can never decode
    // again. Drop it so the next frame builds a fresh one: leaving it in place
    // silently swallowed every later packet from that client, which sounded
    // like the speaker had simply gone mute for good.
    if (entry && (entry.codec !== frame.codec || !entry.dec.usable)) {
      entry.dec.close();
      this.decoders.delete(frame.clientId);
      entry = undefined;
    }
    if (!entry) {
      // Create lazily; frames arriving while the decoder initialises are dropped.
      const codec = frame.codec;
      const placeholder = {
        codec,
        dec: { decode: () => undefined, close: () => undefined, usable: true },
      };
      this.decoders.set(frame.clientId, placeholder);
      void createOpusDecoder(
        codec,
        (left, right) => this.pushPcm(frame.clientId, left, right),
        (err) => {
          // Report once, then let the entry go so the stream can recover.
          this.dropDecoder(frame.clientId);
          this.cb.onError(t("audio.errDecode", { reason: err.message }));
        },
      )
        .then((dec) => {
          const current = this.decoders.get(frame.clientId);
          if (current === placeholder) this.decoders.set(frame.clientId, { codec, dec });
          else dec.close();
        })
        .catch((err: unknown) => this.cb.onError(err instanceof Error ? err.message : String(err)));
      return;
    }
    entry.dec.decode(frame.payload);
  }

  /** Tracks who is whispering to us, reporting only changes. */
  private markWhisper(clientId: number, whispering: boolean): void {
    if (whispering === this.whisperers.has(clientId)) return;
    if (whispering) this.whisperers.add(clientId);
    else this.whisperers.delete(clientId);
    this.cb.onRemoteWhisper?.(clientId, whispering);
  }

  /** Forgets a client's decoder; the next frame from them builds a new one. */
  private dropDecoder(clientId: number): void {
    const entry = this.decoders.get(clientId);
    if (!entry) return;
    this.decoders.delete(clientId);
    try {
      entry.dec.close();
    } catch {
      /* already closed */
    }
  }

  private pushPcm(clientId: number, left: Float32Array, right: Float32Array | null): void {
    if (!this.mixer) return;
    const transfer: ArrayBufferLike[] = [left.buffer];
    if (right && right.buffer !== left.buffer) transfer.push(right.buffer);
    this.mixer.port.postMessage({ type: "pcm", clientId, left, right }, transfer as Transferable[]);
  }

  /* -------------------------------- input -------------------------------- */

  setCodec(codec: number, quality: number): void {
    if (codec === this.codec && quality === this.quality) return;
    this.codec = codec;
    this.quality = quality;
    if (this.capture) void this.rebuildEncoder();
  }

  /**
   * New gate settings. A transmission whose route closes or changes (the
   * whisper key released mid-sentence, talk power taken away) ends at once,
   * so the far side hears an end-of-talk on the route it was listening to.
   */
  setGate(gate: GateState): void {
    const now = performance.now();
    this.gate = { ...gate };
    const route = gateRoute(this.gate, this.gateTimers, now, this.transmitMuted);
    if (this.talkRoute !== null && route !== this.talkRoute) this.endTalk();
  }

  /**
   * The capture worklet and the Opus encoder behind it, built on first use
   * by the microphone or a clip. Two inputs: the mic, and the clip bus.
   */
  private ensureSendPath(): Promise<AudioWorkletNode> {
    if (!this.ctx || !this.started) return Promise.reject(new Error(t("audio.errNotStarted")));
    if (!this.canEncode) return Promise.reject(new Error(t("audio.errNoOpusEncoder")));
    if (this.sendPath) return this.sendPath;
    const capture = new AudioWorkletNode(this.ctx, "jinz-capture", {
      numberOfInputs: 2,
      numberOfOutputs: 0,
      processorOptions: { frameSize: FRAME_SAMPLES },
    });
    capture.port.onmessage = (
      ev: MessageEvent<{ pcm: Float32Array; rms: number; fx?: boolean }>,
    ) => {
      this.onFrame(ev.data.pcm, ev.data.rms, ev.data.fx === true);
    };
    this.capture = capture;
    const ready: Promise<AudioWorkletNode> = this.rebuildEncoder().then(
      () => capture,
      (err: unknown) => {
        if (this.sendPath === ready) this.teardownSendPath();
        throw err;
      },
    );
    this.sendPath = ready;
    return ready;
  }

  private teardownSendPath(): void {
    this.endTalk();
    this.capture?.disconnect();
    this.capture = null;
    this.sendPath = null;
    this.closeEncoder();
    this.gateTimers = CLOSED_GATE;
  }

  /**
   * Closes the encoder, whose pending frames are lost with it. The end
   * markers queued behind them are still owed, or the far side would keep
   * showing us as talking. A build still in flight is superseded, so the
   * encoder it makes is closed on arrival instead of installed.
   */
  private closeEncoder(): void {
    this.encoderBuilds.supersede();
    this.encoder?.close();
    this.encoder = null;
    const queue = this.encodeQueue;
    this.encodeQueue = null;
    queue?.close();
  }

  /** Drops the send path once neither the microphone nor a clip uses it. */
  private releaseSendPathIfIdle(): void {
    if (!this.micStream && !this.sendingClips()) this.teardownSendPath();
  }

  async enableMic(deviceId?: string): Promise<void> {
    if (!this.ctx || !this.started) throw new Error(t("audio.errNotStarted"));
    if (!this.canEncode) throw new Error(t("audio.errNoOpusEncoder"));
    if (this.micStream) return;
    this.micDeviceId = deviceId;
    const capture = await this.ensureSendPath();
    const opening = { ...this.processing };
    let stream: MediaStream;
    try {
      stream = await this.openMic(opening);
    } catch (err) {
      this.releaseSendPathIfIdle();
      throw err;
    }
    if (!this.ctx || this.capture !== capture) {
      // Stopped while the browser asked for the microphone.
      for (const tr of stream.getTracks()) tr.stop();
      throw new Error(t("audio.errNotStarted"));
    }
    this.micStream = stream;
    this.openedWith = opening;
    this.reportApplied(stream);
    const source = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    gain.gain.value = this.micGain;
    gain.connect(capture, 0, MIC_INPUT);
    this.micSource = source;
    this.micGainNode = gain;
    await this.wireInput();
  }

  /**
   * Changes the mic processing switches. A running mic gets them without
   * going through disableMic/enableMic: only the capture track (and, for
   * RNNoise, the stage after it) is swapped, so the encoder, the talk state
   * and the TeamSpeak session carry on — at most a few ms of audio is lost.
   */
  async setProcessing(next: MicProcessing): Promise<void> {
    this.processing = { ...next };
    if (!this.micStream) return;
    // Serialised: overlapping getUserMedia calls on one device race each other,
    // and a quick run of checkbox clicks would otherwise open several tracks.
    const run = this.swapChain.then(() => this.applyProcessing());
    this.swapChain = run.catch(() => undefined);
    return run;
  }

  private async applyProcessing(): Promise<void> {
    if (!this.micStream || !this.ctx) return;
    const want = { ...this.processing };
    if (this.openedWith && needsNewTrack(this.openedWith, want)) await this.replaceTrack(want);
    else if (this.wiredRnnoise !== want.rnnoise) await this.wireInput();
  }

  private async openMic(p: MicProcessing): Promise<MediaStream> {
    return navigator.mediaDevices.getUserMedia({
      audio: micConstraints(p, this.micDeviceId),
    });
  }

  /** Tells the UI what the browser really did with the track now in use. */
  private reportApplied(stream: MediaStream): void {
    const track = stream.getAudioTracks()[0];
    if (track) this.cb.onMicProcessing?.(appliedFrom(track.getSettings()));
  }

  private async replaceTrack(want: MicProcessing): Promise<void> {
    const old = this.micStream;
    const previous = this.openedWith;
    if (!old || !previous) return;
    // The old track goes first: while it is open Chrome hands a new request
    // for the same device that device's existing processing, not the new one.
    this.micSource?.disconnect();
    for (const tr of old.getTracks()) tr.stop();
    let stream: MediaStream;
    let opened = want;
    let failure: unknown = null;
    try {
      stream = await this.openMic(want);
    } catch (err) {
      // Get the mic back the way it was rather than leave it dead.
      failure = err;
      opened = previous;
      try {
        stream = await this.openMic(previous);
      } catch {
        // No mic at all any more (unplugged?): say so instead of pretending.
        await this.disableMic();
        throw err;
      }
    }
    // Switched off while the new track was opening.
    if (this.micStream !== old || !this.ctx) {
      for (const tr of stream.getTracks()) tr.stop();
      return;
    }
    this.micStream = stream;
    this.openedWith = opened;
    this.reportApplied(stream);
    this.micSource = this.ctx.createMediaStreamSource(stream);
    await this.wireInput();
    if (failure) throw failure;
  }

  /** (Re)builds source -> [RNNoise] -> input gain. */
  private async wireInput(): Promise<void> {
    const source = this.micSource;
    const gain = this.micGainNode;
    if (!source || !gain || !this.ctx) return;
    const gen = ++this.wireGen;
    this.wiredRnnoise = this.processing.rnnoise;
    source.disconnect();
    this.denoise?.destroy();
    this.denoise = null;
    if (this.processing.rnnoise) {
      try {
        const { createRnnoiseNode } = await import("./denoise");
        const denoise = await createRnnoiseNode(this.ctx);
        // Superseded while loading (mic off, or rewired again): drop this one.
        if (gen !== this.wireGen || this.micSource !== source) {
          denoise.destroy();
          return;
        }
        this.denoise = denoise;
        source.connect(denoise.node).connect(gain);
        return;
      } catch (err) {
        this.cb.onError(
          t("audio.errDenoise", { reason: err instanceof Error ? err.message : String(err) }),
        );
      }
    }
    // Plain path, also the fallback when RNNoise failed to load.
    if (gen === this.wireGen && this.micSource === source) source.connect(gain);
  }

  /** Turns the microphone off; a clip still being sent keeps the send path until it ends. */
  async disableMic(): Promise<void> {
    this.micGainNode?.disconnect();
    this.micGainNode = null;
    this.denoise?.destroy();
    this.denoise = null;
    this.micSource?.disconnect();
    this.micSource = null;
    for (const t of this.micStream?.getTracks() ?? []) t.stop();
    this.micStream = null;
    this.openedWith = null;
    this.releaseSendPathIfIdle();
  }

  /**
   * Replaces the encoder. Its queue is made first, since the encoder's output
   * feeds it, but both are installed only once the build lands and only if
   * no newer build or teardown came first (see latest-build.ts).
   */
  private async rebuildEncoder(): Promise<void> {
    this.closeEncoder();
    const codec = isOpusCodec(this.codec) ? this.codec : Codec.OpusVoice;
    const quality = this.quality;
    const queue = createEncodeQueue({
      frame: (payload, route) => this.hub.sendVoice(codec, payload, this.upKind(route)),
      end: (route) => this.sendEndMarker(route),
    });
    const encoder = await this.encoderBuilds.run(() =>
      createOpusEncoder(
        codec,
        quality,
        (payload) => queue.encoded(payload),
        (err) => this.cb.onError(t("audio.errEncode", { reason: err.message })),
      ),
    );
    if (!encoder) return;
    this.encoder = encoder;
    this.encodeQueue = queue;
  }

  /** One captured frame: `rms` is the microphone alone, `fx` whether a clip was mixed in. */
  private onFrame(pcm: Float32Array, rms: number, fx: boolean): void {
    this.cb.onLevel(rms);
    if (!this.encoder || !this.encodeQueue) return;
    const step = stepGate(this.gate, this.gateTimers, {
      rms,
      // The worklet's flag is exact; the main-thread count covers the frame a clip starts in.
      clip: fx || this.sendingClips(),
      now: performance.now(),
      transmitMuted: this.transmitMuted,
    });
    this.gateTimers = step.timers;
    const route: GateRoute | null = step.open ? (step.whisper ? "whisper" : "channel") : null;
    if (route !== this.talkRoute) this.endTalk();
    if (route === null) return;
    if (this.talkRoute === null) {
      this.talkRoute = route;
      this.cb.onSelfTalking(true, route === "whisper");
    }
    // Queued first: WebCodecs never calls back synchronously, but the order
    // must hold even if it did.
    this.encodeQueue.pushFrame(route);
    if (!this.encoder.encode(pcm)) this.encodeQueue.dropLastFrame();
  }

  private upKind(route: GateRoute | null): VoiceFrameKind {
    return route === "whisper" ? VoiceFrameKind.UpWhisper : VoiceFrameKind.Up;
  }

  private endTalk(): void {
    const route = this.talkRoute;
    if (route === null) return;
    this.talkRoute = null;
    this.cb.onSelfTalking(false, route === "whisper");
    // With frames in the encoder the marker waits for them; otherwise it goes now.
    if (!this.encoder || !this.encodeQueue) this.sendEndMarker(route);
    else this.encodeQueue.pushEnd(route);
  }

  /** Empty payload tells the server (and other clients) that the transmission ended. */
  private sendEndMarker(route: GateRoute): void {
    this.hub.sendVoice(
      isOpusCodec(this.codec) ? this.codec : Codec.OpusVoice,
      new Uint8Array(0),
      this.upKind(route),
    );
  }
}
