import { computed, markRaw, ref, shallowRef, watch } from "vue";
import { defineStore } from "pinia";
import type { IceServerInfo } from "@jinz/protocol";
import { hub } from "../ts/hub";
import { useTsStore } from "./ts";
import { MeshRoom } from "../rtc/mesh";
import { LiveKitRoom } from "../rtc/livekit";
import {
  DEFAULT_SCREEN_OPTIONS,
  isStreamLive,
  type PeerStatus,
  type RtcRoom,
  type ScreenShareOptions,
  type TrackView,
} from "../rtc/types";
import { t, translateCode } from "../i18n";

export type RtcState = "idle" | "connecting" | "connected";
export type { TrackView, PeerStatus, ScreenShareOptions } from "../rtc/types";

type JoinGrant =
  | { kind: "livekit"; url: string; token: string; room: string }
  | { kind: "mesh"; room: string; selfClientId: number; iceServers: IceServerInfo[] };

const SCREEN_OPTS_KEY = "jinz.rtc.screen";

function loadScreenOptions(): ScreenShareOptions {
  try {
    const raw = localStorage.getItem(SCREEN_OPTS_KEY);
    if (raw)
      return { ...DEFAULT_SCREEN_OPTIONS, ...(JSON.parse(raw) as Partial<ScreenShareOptions>) };
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_SCREEN_OPTIONS };
}

export const useRtcStore = defineStore("rtc", () => {
  const ts = useTsStore();
  const room = shallowRef<RtcRoom | null>(null);
  const state = ref<RtcState>("idle");
  const error = ref<string | null>(null);
  const roomName = ref("");
  const backend = ref<"mesh" | "livekit" | null>(null);
  // shallowRef: track views wrap live browser objects that must not be deep-proxied.
  const tracks = shallowRef<TrackView[]>([]);
  const peers = shallowRef<PeerStatus[]>([]);
  const participantCount = ref(0);
  const cameraOn = ref(false);
  const screenOn = ref(false);
  /** User intent: keep the video room in sync with the TS channel while true. */
  const wantVideo = ref(false);
  const focusedSid = ref<string | null>(null);
  /** Bumped when the UI should bring the video panel to the front. */
  const revealTick = ref(0);
  const screenOptions = ref<ScreenShareOptions>(loadScreenOptions());
  /** Client whose screen/camera should get focus as soon as its track shows up. */
  const pendingWatch = ref<number | null>(null);
  /**
   * A screen capture carried across a reconnect. The browser will not hand out
   * a new one without a fresh gesture, so the stream is kept alive while the
   * link is down and re-published into the new room.
   */
  const heldScreen = shallowRef<MediaStream | null>(null);
  /**
   * A camera is not re-enabled on its own — coming back with the lens live is
   * not obviously what the user wants — so the banner offers it instead.
   */
  const cameraResumeOffered = ref(false);

  const available = computed(() => ts.features.video);
  const videoTracks = computed(() => tracks.value.filter((t) => t.kind === "video"));
  const audioTracks = computed(() => tracks.value.filter((t) => t.kind === "audio"));
  /** Web users in my channel who joined the video room (from hub room state). */
  const members = computed(() => ts.roomState?.video.members ?? []);
  /** Channel mates currently sharing something. */
  const publishers = computed(() => ts.roomState?.video.publishers ?? []);

  watch(screenOptions, (o) => localStorage.setItem(SCREEN_OPTS_KEY, JSON.stringify(o)), {
    deep: true,
  });

  /* ------------------------------------------------------------ hub link */

  let pendingJoin: { resolve(g: JoinGrant): void; reject(e: Error): void } | null = null;
  hub.onMessage((msg) => {
    if (msg.type === "rtc.token" && pendingJoin) {
      pendingJoin.resolve({ kind: "livekit", url: msg.url, token: msg.token, room: msg.room });
      pendingJoin = null;
    } else if (msg.type === "rtc.mesh" && pendingJoin) {
      pendingJoin.resolve({
        kind: "mesh",
        room: msg.room,
        selfClientId: msg.selfClientId,
        iceServers: msg.iceServers,
      });
      pendingJoin = null;
    } else if (msg.type === "error" && msg.code === "rtc_unavailable" && pendingJoin) {
      pendingJoin.reject(new Error(translateCode(msg.message)));
      pendingJoin = null;
    } else if (msg.type === "rtc.signal") {
      const r = room.value;
      if (r instanceof MeshRoom) r.handleSignal(msg.from, msg.payload);
    }
  });

  function requestJoin(): Promise<JoinGrant> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingJoin = null;
        reject(new Error(t("video.errRoomTimeout")));
      }, 10_000);
      pendingJoin = {
        resolve: (g) => {
          window.clearTimeout(timer);
          resolve(g);
        },
        reject: (e) => {
          window.clearTimeout(timer);
          reject(e);
        },
      };
      hub.send({ type: "rtc.join" });
    });
  }

  // Mesh peers follow the hub's member list.
  watch(
    () => ts.roomState,
    (st) => {
      const r = room.value;
      if (r instanceof MeshRoom && st) r.setMembers(st.video.members);
    },
  );

  /* --------------------------------------------------------------- sync */

  const events = {
    onChange: () => sync(),
    onError: (message: string) => {
      error.value = message;
    },
    onScreenEnded: () => sync(),
  };

  function sync(): void {
    const r = room.value;
    if (!r) {
      tracks.value = [];
      peers.value = [];
      participantCount.value = 0;
      if (cameraOn.value || screenOn.value) {
        cameraOn.value = false;
        screenOn.value = false;
      }
      return;
    }
    tracks.value = r.tracks.map((t) => markRaw(t));
    peers.value = r.peers;
    participantCount.value = r.participantCount;
    if (r.cameraOn !== cameraOn.value || r.screenOn !== screenOn.value) {
      cameraOn.value = r.cameraOn;
      screenOn.value = r.screenOn;
      hub.send({ type: "rtc.publishing", camera: r.cameraOn, screen: r.screenOn });
    }
    const videos = tracks.value.filter((t) => t.kind === "video");
    if (focusedSid.value && !videos.some((t) => t.sid === focusedSid.value)) {
      focusedSid.value = null;
    }
    if (pendingWatch.value !== null) {
      const want = pendingWatch.value;
      const hit =
        videos.find((t) => t.clientId === want && t.source === "screen") ??
        videos.find((t) => t.clientId === want && !t.isLocal);
      if (hit) {
        focusedSid.value = hit.sid;
        pendingWatch.value = null;
      }
    }
    // Nothing focused yet: a remote screen share is what people want to see big.
    if (!focusedSid.value) {
      const share = videos.find((t) => !t.isLocal && t.source === "screen");
      if (share) focusedSid.value = share.sid;
    }
  }

  /* ------------------------------------------------------------ actions */

  async function join(): Promise<void> {
    if (state.value !== "idle") return;
    if (!available.value) {
      error.value = t("video.unavailable");
      return;
    }
    error.value = null;
    state.value = "connecting";
    wantVideo.value = true;
    try {
      const grant = await requestJoin();
      let r: RtcRoom;
      if (grant.kind === "livekit") {
        r = await LiveKitRoom.connect(grant.url, grant.token, events);
      } else {
        const mesh = new MeshRoom({
          selfClientId: grant.selfClientId,
          selfName: ts.selfClient?.nickname ?? t("info.me"),
          iceServers: grant.iceServers,
          send: (m) => hub.send(m),
          ...events,
        });
        r = mesh;
      }
      room.value = markRaw(r);
      roomName.value = grant.room;
      backend.value = grant.kind;
      state.value = "connected";
      if (r instanceof MeshRoom && ts.roomState) r.setMembers(ts.roomState.video.members);
      sync();
      await republishHeldScreen();
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      state.value = "idle";
      wantVideo.value = false;
    }
  }

  async function leave(): Promise<void> {
    wantVideo.value = false;
    pendingWatch.value = null;
    discardHeld();
    const r = room.value;
    room.value = null;
    state.value = "idle";
    backend.value = null;
    cameraOn.value = false;
    screenOn.value = false;
    hub.send({ type: "rtc.leave" });
    if (r) await r.close().catch(() => undefined);
    sync();
  }

  async function toggleCamera(): Promise<void> {
    const r = room.value;
    if (!r) return;
    try {
      await r.setCamera(!r.cameraOn);
    } catch (err) {
      if (!isUserCancel(err)) error.value = describe(err);
    }
    sync();
  }

  /** Starts (or restarts with new options) the screen share; joins the room first if needed. */
  async function shareScreen(stream?: MediaStream): Promise<void> {
    if (state.value === "idle") await join();
    if (state.value === "connecting") {
      // join() awaits connection; if we are still connecting the join failed.
      return;
    }
    const r = room.value;
    if (!r) return;
    revealTick.value++;
    try {
      await r.setScreen(true, { ...screenOptions.value }, stream);
      error.value = null;
    } catch (err) {
      if (!isUserCancel(err)) error.value = describe(err);
    }
    sync();
  }

  async function stopScreen(): Promise<void> {
    const r = room.value;
    if (!r) return;
    try {
      await r.setScreen(false, screenOptions.value);
    } catch (err) {
      error.value = describe(err);
    }
    sync();
  }

  async function toggleScreen(): Promise<void> {
    if (screenOn.value) await stopScreen();
    else await shareScreen();
  }

  /** Open the video panel and focus this user's screen (joining the room if necessary). */
  async function watch_(clientId: number): Promise<void> {
    pendingWatch.value = clientId;
    revealTick.value++;
    if (state.value === "idle") await join();
    else sync();
  }

  function reveal(): void {
    revealTick.value++;
  }

  // Follow the TS channel: switching channel means switching room.
  watch(
    () => ts.selfChannel?.id,
    async (id, prev) => {
      if (!wantVideo.value || id === prev) return;
      // Losing the channel is not a switch. A session on its way out drops our
      // own client first, so this watcher sees `undefined` while connState is
      // still "connected" — and closing the room here would stop the very
      // captures the connState watcher is about to park for the reconnect.
      // Act only on a real move to another channel; teardown belongs to it.
      if (!id) return;
      const r = room.value;
      room.value = null;
      state.value = "idle";
      if (r) await r.close().catch(() => undefined);
      sync();
      if (id) await join();
    },
  );
  /**
   * A TeamSpeak drop tears the room down, but the screen capture behind it is
   * worth keeping: the browser will not hand out another without a fresh
   * gesture. Park it here; `join()` re-publishes it when the channel watcher
   * brings us back.
   */
  watch(
    () => ts.connState,
    async (s) => {
      if (s === "connected") return;
      if (!room.value && state.value === "idle") return;
      const resume = wantVideo.value;
      // Read the flags first: detachLocalMedia() reports a change, and the
      // sync() behind it zeroes cameraOn/screenOn before we could read them.
      const hadCamera = cameraOn.value;
      // Take the captures before leave() closes the room and stops them.
      const held = room.value?.detachLocalMedia() ?? { camera: null, screen: null };
      // A camera capture is not worth holding: re-opening it needs only a
      // permission we already have, unlike getDisplayMedia's gesture.
      stopHeld(held.camera);
      await leave();
      // The user disconnected on purpose; nothing to come back to.
      if (!resume) {
        stopHeld(held.screen);
        return;
      }
      wantVideo.value = true;
      heldScreen.value = held.screen;
      cameraResumeOffered.value = hadCamera;
    },
  );

  /**
   * Re-publishes a screen capture carried across a reconnect. Called from
   * `join()`, so the rejoin that the channel watcher drives is the only thing
   * that can bring the share back — two paths racing to join would let one
   * close the room the other had just published into.
   */
  async function republishHeldScreen(): Promise<void> {
    const screen = heldScreen.value;
    if (!screen) return;
    heldScreen.value = null;
    const r = room.value;
    if (!r || state.value !== "connected") {
      stopHeld(screen);
      return;
    }
    // The user may have stopped sharing at the OS level while we were away.
    if (!isStreamLive(screen)) {
      stopHeld(screen);
      ts.pushEvent(t("event.screenResumeEnded"), "warn");
      return;
    }
    try {
      await r.setScreen(true, { ...screenOptions.value }, screen);
      ts.pushEvent(t("event.screenResumed"));
    } catch (err) {
      stopHeld(screen);
      error.value = describe(err);
    }
    sync();
  }

  /** Turns the camera back on after a reconnect; wired to the banner action. */
  async function resumeCamera(): Promise<void> {
    cameraResumeOffered.value = false;
    if (state.value === "idle") await join();
    const r = room.value;
    if (!r || r.cameraOn) return;
    try {
      await r.setCamera(true);
    } catch (err) {
      if (!isUserCancel(err)) error.value = describe(err);
    }
    sync();
  }

  function dismissCameraResume(): void {
    cameraResumeOffered.value = false;
  }

  function stopHeld(stream: MediaStream | null): void {
    stream?.getTracks().forEach((t) => t.stop());
  }

  /** Throws away anything parked for a resume; for a deliberate leave. */
  function discardHeld(): void {
    stopHeld(heldScreen.value);
    heldScreen.value = null;
    cameraResumeOffered.value = false;
  }

  if (import.meta.env.DEV) {
    // Lets a dev console publish any MediaStream (e.g. canvas.captureStream()) as a
    // screen share, and drive the room the way the video panel's buttons do.
    (window as unknown as { __jinzRtc: unknown }).__jinzRtc = {
      shareStream: (s: MediaStream) => shareScreen(s),
      share: () => shareScreen(),
      camera: () => toggleCamera(),
      resumeCamera: () => resumeCamera(),
      state: () => ({
        state: state.value,
        backend: backend.value,
        cameraOn: cameraOn.value,
        screenOn: screenOn.value,
        cameraResumeOffered: cameraResumeOffered.value,
        wantVideo: wantVideo.value,
        tracks: tracks.value.map((t) => ({ ...t, attach: undefined, detach: undefined })),
        peers: peers.value,
      }),
    };
  }

  return {
    room,
    state,
    error,
    roomName,
    backend,
    tracks,
    videoTracks,
    audioTracks,
    peers,
    members,
    publishers,
    participantCount,
    cameraOn,
    screenOn,
    wantVideo,
    focusedSid,
    revealTick,
    screenOptions,
    available,
    cameraResumeOffered,
    join,
    leave,
    resumeCamera,
    dismissCameraResume,
    toggleCamera,
    toggleScreen,
    shareScreen,
    stopScreen,
    watch: watch_,
    reveal,
  };
});

function isUserCancel(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")
  );
}

function describe(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === "NotFoundError") return t("video.errNoDevice");
    if (err.name === "NotReadableError") return t("video.errDeviceBusy");
    if (err.name === "NotSupportedError") return t("video.errInsecure");
  }
  return err instanceof Error ? err.message : String(err);
}
