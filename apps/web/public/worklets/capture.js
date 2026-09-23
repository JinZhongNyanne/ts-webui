/* global AudioWorkletProcessor, registerProcessor, sampleRate */
/**
 * Capture worklet: groups the 128-sample render quanta into fixed-size frames
 * (default 960 samples = 20 ms at 48 kHz), computes the frame RMS and posts
 * { pcm: Float32Array, rms: number, fx: boolean } to the main thread.
 *
 * Input 0 is the microphone (after the input volume). Input 1, when the node
 * has one, is the soundboard bus: clips mixed into what is sent. `rms` is the
 * microphone's alone, so voice activation and the level meter keep judging the
 * voice; `fx` says a clip was playing in the frame, so the main thread holds
 * the transmit gate open for it. Either input may have nothing connected (no
 * mic, or no clip); a frame is only built while at least one of them has.
 *
 * Runs at the AudioContext sample rate; the main thread must create the
 * context at 48 kHz so frames line up with Opus.
 */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const frameSize =
      (options && options.processorOptions && options.processorOptions.frameSize) || 960;
    this.frameSize = frameSize;
    this.buffer = new Float32Array(frameSize);
    this.fxBuffer = new Float32Array(frameSize);
    this.fxSeen = false;
    this.fill = 0;
    this.enabled = true;
    this.port.onmessage = (ev) => {
      if (ev.data && typeof ev.data.enabled === "boolean") this.enabled = ev.data.enabled;
    };
  }

  process(inputs) {
    const mic = this.mono(inputs[0]);
    const fx = this.mono(inputs[1]);
    if (!mic && !fx) return true;
    const length = (mic || fx).length;
    let offset = 0;
    while (offset < length) {
      const take = Math.min(this.frameSize - this.fill, length - offset);
      if (mic) this.buffer.set(mic.subarray(offset, offset + take), this.fill);
      else this.buffer.fill(0, this.fill, this.fill + take);
      if (fx) {
        this.fxBuffer.set(fx.subarray(offset, offset + take), this.fill);
        this.fxSeen = true;
      }
      this.fill += take;
      offset += take;
      if (this.fill === this.frameSize) this.flush();
    }
    return true;
  }

  flush() {
    if (this.enabled) {
      let sum = 0;
      for (let i = 0; i < this.frameSize; i++) sum += this.buffer[i] * this.buffer[i];
      const rms = Math.sqrt(sum / this.frameSize);
      const out = this.buffer.slice();
      if (this.fxSeen) {
        for (let i = 0; i < this.frameSize; i++) {
          const v = out[i] + this.fxBuffer[i];
          out[i] = v > 1 ? 1 : v < -1 ? -1 : v;
        }
      }
      this.port.postMessage({ pcm: out, rms, fx: this.fxSeen }, [out.buffer]);
    }
    if (this.fxSeen) this.fxBuffer.fill(0);
    this.fxSeen = false;
    this.fill = 0;
  }

  /** One input as a single channel, or null when nothing is connected to it. */
  mono(channels) {
    if (!channels || channels.length === 0 || !channels[0]) return null;
    if (channels.length === 1) return channels[0];
    const n = channels[0].length;
    const out = new Float32Array(n);
    for (let c = 0; c < channels.length; c++) {
      const data = channels[c];
      for (let i = 0; i < n; i++) out[i] += data[i] / channels.length;
    }
    return out;
  }
}

registerProcessor("jinz-capture", CaptureProcessor);
