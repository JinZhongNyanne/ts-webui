/**
 * Optional RNNoise suppression, via @sapphi-red/web-noise-suppressor (MIT;
 * RNNoise itself is BSD-3). Imported dynamically by the engine, so the ~65 KB
 * worklet and ~155 KB wasm are only fetched by users who switch it on.
 *
 * RNNoise works on 48 kHz audio; the voice engine's context already runs at
 * that rate for Opus, so no resampling is involved.
 */
import { loadRnnoise, RnnoiseWorkletNode } from "@sapphi-red/web-noise-suppressor";
import workletUrl from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import wasmUrl from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import simdUrl from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

let wasm: Promise<ArrayBuffer> | null = null;
/** addModule is per context; the engine makes a new context on every start. */
const registered = new WeakSet<BaseAudioContext>();

export interface DenoiseNode {
  node: AudioNode;
  destroy: () => void;
}

export async function createRnnoiseNode(ctx: AudioContext): Promise<DenoiseNode> {
  // A failed download must not poison every later attempt.
  wasm ??= loadRnnoise({ url: wasmUrl, simdUrl }).catch((err: unknown) => {
    wasm = null;
    throw err;
  });
  const binary = await wasm;
  if (!registered.has(ctx)) {
    await ctx.audioWorklet.addModule(workletUrl);
    registered.add(ctx);
  }
  const node = new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary: binary });
  return {
    node,
    destroy: () => {
      node.disconnect();
      node.destroy();
    },
  };
}
