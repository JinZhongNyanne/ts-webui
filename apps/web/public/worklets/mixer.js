/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * Mixer worklet: one jitter queue per remote client, mixed to stereo output.
 *
 * Per-client processing chain:
 *   queue -> user gain -> auto-level gain (optional) -> sum
 * Master chain:
 *   sum + effects input -> master gain -> hearing-protection limiter (optional) -> soft clip
 *
 * The node's one input is the effects bus: sounds the page plays itself (a
 * user's channel-entry sound) are connected to it, so the limiter protects
 * against a loud clip as it does against a loud voice.
 *
 * Messages from the main thread:
 *   { type: "pcm", clientId, left: Float32Array, right?: Float32Array }
 *   { type: "gain", clientId, value }            per-client volume (0..2)
 *   { type: "master", value }                    master volume (0..2)
 *   { type: "remove", clientId }
 *   { type: "mute", on }                        drop queued audio and stay silent
 *   { type: "autolevel", on, targetDb }          normalize everyone to targetDb (RMS, dBFS)
 *   { type: "limiter", on, thresholdDb }         clamp peaks above thresholdDb (dBFS)
 *
 * Messages to the main thread:
 *   { type: "level", clientId, active }          talk activity transitions
 *   { type: "meter", clients: {id: {rmsDb, autoGainDb}}, master: {peakDb, reductionDb} }  ~4x/s
 */
const TARGET_QUEUE_SAMPLES = 960 * 2; // ~40 ms of pre-buffer before a stream starts playing
const MAX_QUEUE_SAMPLES = 960 * 12; // drop when more than ~240 ms accumulates
const SILENCE_TIMEOUT_BLOCKS = 12; // ~32 ms of starvation before we consider the client silent
const METER_INTERVAL_BLOCKS = 94; // 128 * 94 / 48000 ≈ 0.25 s
const LOUDNESS_WINDOW_SEC = 30; // auto-level looks at the last 30 s of a client's speech
const SPEECH_GATE_DB = -50; // blocks quieter than this don't count as speech for loudness

function dbToGain(db) {
  return Math.pow(10, db / 20);
}
function gainToDb(g) {
  return g <= 1e-9 ? -180 : 20 * Math.log10(g);
}

/**
 * Tracks a client's average loudness over a sliding window of ~30 s of speech,
 * using coarse 250 ms energy buckets so the memory stays tiny.
 */
class LoudnessHistory {
  constructor() {
    this.bucketBlocks = METER_INTERVAL_BLOCKS;
    this.maxBuckets = Math.ceil((LOUDNESS_WINDOW_SEC * sampleRate) / (128 * this.bucketBlocks));
    this.buckets = []; // mean-square per bucket (speech only)
    this.accSq = 0;
    this.accN = 0;
    this.blockCount = 0;
  }
  push(meanSq) {
    if (gainToDb(Math.sqrt(meanSq)) > SPEECH_GATE_DB) {
      this.accSq += meanSq;
      this.accN++;
    }
    if (++this.blockCount >= this.bucketBlocks) {
      if (this.accN > 0) {
        this.buckets.push(this.accSq / this.accN);
        if (this.buckets.length > this.maxBuckets) this.buckets.shift();
      }
      this.accSq = 0;
      this.accN = 0;
      this.blockCount = 0;
    }
  }
  /** RMS in dBFS over the window, or null when we have too little speech yet. */
  rmsDb() {
    if (this.buckets.length < 2) return null;
    let s = 0;
    for (const b of this.buckets) s += b;
    return gainToDb(Math.sqrt(s / this.buckets.length));
  }
}

class ClientStream {
  constructor() {
    this.chunks = []; // { left, right, offset }
    this.queued = 0;
    this.gain = 1;
    this.primed = false;
    this.starvedBlocks = 0;
    this.active = false;
    this.history = new LoudnessHistory();
    this.autoGain = 1; // smoothed
    this.lastRmsDb = -180;
  }

  push(left, right) {
    this.chunks.push({ left, right: right || left, offset: 0 });
    this.queued += left.length;
    while (this.queued > MAX_QUEUE_SAMPLES && this.chunks.length > 1) {
      const dropped = this.chunks.shift();
      this.queued -= dropped.left.length - dropped.offset;
    }
    if (!this.primed && this.queued >= TARGET_QUEUE_SAMPLES) this.primed = true;
  }

  /** Pulls up to n samples into tmpL/tmpR (mono duplicates). Returns produced count. */
  pull(tmpL, tmpR, n) {
    if (!this.primed) return 0;
    let produced = 0;
    while (produced < n && this.chunks.length > 0) {
      const chunk = this.chunks[0];
      const avail = chunk.left.length - chunk.offset;
      const take = Math.min(avail, n - produced);
      for (let i = 0; i < take; i++) {
        tmpL[produced + i] = chunk.left[chunk.offset + i];
        tmpR[produced + i] = chunk.right[chunk.offset + i];
      }
      chunk.offset += take;
      produced += take;
      this.queued -= take;
      if (chunk.offset >= chunk.left.length) this.chunks.shift();
    }
    if (produced === 0) this.primed = false; // re-buffer before the next burst
    return produced;
  }
}

class MixerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.streams = new Map();
    this.muted = false;
    this.master = 1;
    this.autoLevel = false;
    this.autoTargetDb = -18;
    this.limiterOn = false;
    this.limiterThreshold = dbToGain(-6);
    this.limiterGain = 1; // current gain reduction (1 = none)
    this.limiterRelease = Math.exp(-1 / (0.25 * sampleRate)); // ~250 ms release
    this.tmpL = new Float32Array(128);
    this.tmpR = new Float32Array(128);
    this.meterBlocks = 0;
    this.masterPeak = 0;
    this.port.onmessage = (ev) => this.onMessage(ev.data);
  }

  onMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "pcm": {
        if (this.muted) break; // late frames from an in-flight decode
        let s = this.streams.get(msg.clientId);
        if (!s) {
          s = new ClientStream();
          this.streams.set(msg.clientId, s);
        }
        s.push(msg.left, msg.right);
        break;
      }
      case "gain": {
        let s = this.streams.get(msg.clientId);
        if (!s) {
          s = new ClientStream();
          this.streams.set(msg.clientId, s);
        }
        s.gain = msg.value;
        break;
      }
      case "master":
        this.master = msg.value;
        break;
      case "remove":
        this.streams.delete(msg.clientId);
        break;
      case "mute":
        this.muted = !!msg.on;
        // Muting must be instant, so throw the jitter buffers away rather than
        // letting the already-queued audio drain.
        if (this.muted) {
          for (const [clientId, s] of this.streams) {
            s.chunks = [];
            s.queued = 0;
            s.primed = false;
            s.starvedBlocks = 0;
            if (s.active) {
              s.active = false;
              this.port.postMessage({ type: "level", clientId, active: false });
            }
          }
        }
        break;
      case "autolevel":
        this.autoLevel = !!msg.on;
        if (typeof msg.targetDb === "number") this.autoTargetDb = msg.targetDb;
        if (!this.autoLevel) for (const s of this.streams.values()) s.autoGain = 1;
        break;
      case "limiter":
        this.limiterOn = !!msg.on;
        if (typeof msg.thresholdDb === "number") this.limiterThreshold = dbToGain(msg.thresholdDb);
        if (!this.limiterOn) this.limiterGain = 1;
        break;
      default:
        break;
    }
  }

  /** Auto-level: move the client's smoothed gain toward target/measured, within ±12 dB. */
  updateAutoGain(s) {
    const measured = s.history.rmsDb();
    let target = 1;
    if (measured !== null) {
      const wantDb = Math.max(-12, Math.min(12, this.autoTargetDb - measured));
      target = dbToGain(wantDb);
    }
    // Smooth over roughly a second of blocks so gain doesn't pump.
    s.autoGain += (target - s.autoGain) * 0.01;
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] || output[0];
    outL.fill(0);
    if (outR !== outL) outR.fill(0);
    const n = outL.length;
    const tmpL = this.tmpL;
    const tmpR = this.tmpR;

    for (const [clientId, s] of this.streams) {
      const produced = s.pull(tmpL, tmpR, n);
      if (produced > 0) {
        // Loudness measurement on the raw (pre-gain) signal.
        let sq = 0;
        for (let i = 0; i < produced; i++) sq += tmpL[i] * tmpL[i];
        const meanSq = sq / produced;
        s.lastRmsDb = gainToDb(Math.sqrt(meanSq));
        s.history.push(meanSq);
        if (this.autoLevel) this.updateAutoGain(s);
        else s.autoGain = 1;

        const g = s.gain * s.autoGain;
        for (let i = 0; i < produced; i++) {
          outL[i] += tmpL[i] * g;
          outR[i] += tmpR[i] * g;
        }
        s.starvedBlocks = 0;
        if (!s.active) {
          s.active = true;
          this.port.postMessage({ type: "level", clientId, active: true });
        }
      } else if (s.active) {
        s.starvedBlocks++;
        if (s.starvedBlocks > SILENCE_TIMEOUT_BLOCKS) {
          s.active = false;
          this.port.postMessage({ type: "level", clientId, active: false });
        }
      }
    }

    // The effects bus joins the mix; speaker mute silences it like the voices.
    const fx = inputs[0];
    if (fx && fx.length > 0 && !this.muted) {
      const fxL = fx[0];
      const fxR = fx[1] || fx[0];
      for (let i = 0; i < n; i++) {
        outL[i] += fxL[i];
        outR[i] += fxR[i];
      }
    }

    // Master gain, then hearing-protection limiter (fast attack, slow release).
    const m = this.master;
    let blockPeak = 0;
    for (let i = 0; i < n; i++) {
      let l = outL[i] * m;
      let r = outR[i] * m;
      if (this.limiterOn) {
        const peak = Math.max(Math.abs(l), Math.abs(r));
        // Required gain so this sample sits at the threshold; attack instantly.
        const needed = peak > this.limiterThreshold ? this.limiterThreshold / peak : 1;
        if (needed < this.limiterGain) this.limiterGain = needed;
        else this.limiterGain = 1 - (1 - this.limiterGain) * this.limiterRelease;
        l *= this.limiterGain;
        r *= this.limiterGain;
      }
      // Soft clip as a last resort.
      if (l > 1) l = 1;
      else if (l < -1) l = -1;
      if (r > 1) r = 1;
      else if (r < -1) r = -1;
      outL[i] = l;
      outR[i] = r;
      const p = Math.max(Math.abs(l), Math.abs(r));
      if (p > blockPeak) blockPeak = p;
    }
    if (blockPeak > this.masterPeak) this.masterPeak = blockPeak;

    if (++this.meterBlocks >= METER_INTERVAL_BLOCKS) {
      this.meterBlocks = 0;
      const clients = {};
      for (const [id, s] of this.streams) {
        clients[id] = {
          rmsDb: s.active ? Math.round(s.lastRmsDb) : -180,
          avgDb: s.history.rmsDb(),
          autoGainDb: Math.round(gainToDb(s.autoGain) * 10) / 10,
        };
      }
      this.port.postMessage({
        type: "meter",
        clients,
        master: {
          peakDb: Math.round(gainToDb(this.masterPeak)),
          reductionDb: Math.round(gainToDb(this.limiterGain) * 10) / 10,
        },
      });
      this.masterPeak = 0;
    }
    return true;
  }
}

registerProcessor("jinz-mixer", MixerProcessor);
