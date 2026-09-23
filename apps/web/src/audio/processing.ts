/**
 * Microphone processing switches and the getUserMedia constraints they map to.
 *
 * The browser's echo cancellation, noise suppression and auto gain are tuned
 * for speech: they duck, pump and smear music and instruments. So they are
 * individually switchable, and `rnnoise` is an optional extra suppressor (a
 * small wasm model) that runs in our own audio graph before the encoder.
 */

export interface MicProcessing {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
  /** RNNoise in an AudioWorklet, on top of (or instead of) the browser's suppressor. */
  rnnoise: boolean;
}

export const DEFAULT_PROCESSING: MicProcessing = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  rnnoise: false,
};

export function micConstraints(p: MicProcessing, deviceId?: string): MediaTrackConstraints {
  return {
    channelCount: 1,
    echoCancellation: p.echoCancellation,
    noiseSuppression: p.noiseSuppression,
    autoGainControl: p.autoGainControl,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
}

/**
 * Whether a change needs a new capture track. The three browser switches are
 * fixed when the track is opened, so they need a
 * fresh getUserMedia (switching them live via `applyConstraints` is not
 * reliable across browsers). RNNoise lives in our graph and only needs rewiring.
 */
export function needsNewTrack(prev: MicProcessing, next: MicProcessing): boolean {
  return (
    prev.echoCancellation !== next.echoCancellation ||
    prev.noiseSuppression !== next.noiseSuppression ||
    prev.autoGainControl !== next.autoGainControl
  );
}

/** What the browser actually applied (it may ignore a request), for the settings readout. */
export interface AppliedProcessing {
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  autoGainControl: boolean | null;
}

export function appliedFrom(settings: MediaTrackSettings): AppliedProcessing {
  const read = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
  return {
    echoCancellation: read(settings.echoCancellation),
    noiseSuppression: read(settings.noiseSuppression),
    autoGainControl: read(settings.autoGainControl),
  };
}
