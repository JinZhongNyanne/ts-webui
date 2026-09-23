/**
 * Backend-neutral view of a video room. Two implementations exist:
 *  - MeshRoom:    direct WebRTC between browsers, signalled through the hub
 *  - LiveKitRoom: SFU, when the hub has LiveKit configured
 * The Pinia store and the UI only ever see this interface.
 */

export type TrackSource = "camera" | "screen" | "screen_audio" | "mic" | "unknown";

export interface TrackView {
  /** Stable id for list keys. */
  sid: string;
  kind: "video" | "audio";
  source: TrackSource;
  /** TeamSpeak client id of the owner (null when unknown). */
  clientId: number | null;
  participantName: string;
  isLocal: boolean;
  attach(el: HTMLMediaElement): void;
  detach(el: HTMLMediaElement): void;
}

export interface ScreenShareOptions {
  /** Capture frame rate. */
  fps: 5 | 15 | 30 | 60;
  /** Maximum height in pixels; 0 keeps the native resolution. */
  maxHeight: 0 | 720 | 1080 | 1440;
  /** Also share tab/system audio when the browser offers it. */
  audio: boolean;
  /** Optimise for crisp text ("detail") or smooth motion ("motion"). */
  contentHint: "detail" | "motion";
}

export const DEFAULT_SCREEN_OPTIONS: ScreenShareOptions = {
  fps: 30,
  maxHeight: 1080,
  audio: true,
  contentHint: "detail",
};

/** Local captures handed back by `detachLocalMedia()`; either may be null. */
export interface LocalMedia {
  camera: MediaStream | null;
  screen: MediaStream | null;
}

/** True while a stream still has a live video track to re-publish. */
export function isStreamLive(stream: MediaStream | null): boolean {
  return !!stream?.getVideoTracks().some((t) => t.readyState === "live");
}

export type PeerPath = "host" | "srflx" | "prflx" | "relay" | "unknown";

export interface PeerStatus {
  clientId: number;
  nickname: string;
  state: RTCPeerConnectionState;
  /** How the media flows once connected: LAN, NAT-traversed, or via TURN relay. */
  path: PeerPath;
}

export interface RtcRoomEvents {
  /** Anything observable changed (tracks, peers, publishing flags). */
  onChange(): void;
  onError(message: string): void;
  /** The browser's own "stop sharing" control ended the screen capture. */
  onScreenEnded(): void;
}

export interface RtcRoom {
  readonly kind: "mesh" | "livekit";
  readonly tracks: TrackView[];
  readonly participantCount: number;
  readonly cameraOn: boolean;
  readonly screenOn: boolean;
  readonly peers: PeerStatus[];
  setCamera(on: boolean): Promise<void>;
  /** `stream` lets callers hand in a capture they already own (tests, custom sources). */
  setScreen(on: boolean, opts: ScreenShareOptions, stream?: MediaStream): Promise<void>;
  /**
   * Stops publishing the local captures and hands them back with their tracks
   * still live, so a caller can re-publish them into a new room. This is the
   * one way out of the room that does not stop what it was sending: both
   * `setScreen(false)` and `close()` deliberately do stop it.
   *
   * After this the room no longer owns the streams; stopping them is the
   * caller's job. Used to carry a screen share across a reconnect, where the
   * browser would otherwise demand a fresh gesture for `getDisplayMedia`.
   */
  detachLocalMedia(): LocalMedia;
  close(): Promise<void>;
}

/** Target encoder bitrate for a screen share, from its capture settings. */
export function screenBitrate(opts: ScreenShareOptions): number {
  const base =
    opts.maxHeight === 720
      ? 2_500_000
      : opts.maxHeight === 1080
        ? 4_000_000
        : opts.maxHeight === 1440
          ? 6_000_000
          : 5_000_000;
  const fpsFactor = opts.fps >= 60 ? 1.5 : opts.fps <= 15 ? 0.6 : 1;
  return Math.round(base * fpsFactor);
}

/** getDisplayMedia constraints for the chosen quality (Chrome-only hints are harmless elsewhere). */
export function displayMediaConstraints(opts: ScreenShareOptions): DisplayMediaStreamOptions {
  const video: MediaTrackConstraints = { frameRate: { ideal: opts.fps, max: opts.fps } };
  if (opts.maxHeight) video.height = { max: opts.maxHeight };
  const extra = {
    // Hide our own tab from the picker; allow switching the shared surface mid-call.
    selfBrowserSurface: "exclude",
    surfaceSwitching: "include",
    systemAudio: "include",
    monitorTypeSurfaces: "include",
  };
  return {
    video,
    audio: opts.audio
      ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : false,
    ...extra,
  } as DisplayMediaStreamOptions;
}

/** Wraps a single MediaStreamTrack for attach/detach on <video>/<audio>. */
export function mediaTrackAttachers(track: MediaStreamTrack): Pick<TrackView, "attach" | "detach"> {
  return {
    attach(el) {
      el.srcObject = new MediaStream([track]);
      // Autoplay can be blocked until a gesture; a later play() call is harmless.
      void el.play?.().catch(() => undefined);
    },
    detach(el) {
      if (el.srcObject) el.srcObject = null;
    },
  };
}
