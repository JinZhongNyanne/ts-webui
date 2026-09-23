/**
 * LiveKit (SFU) backend. Used when the hub is configured with a LiveKit server;
 * scales to large rooms because each publisher uploads a single stream.
 * livekit-client (~700 kB) is loaded on demand.
 */
import type { Participant, Room, Track } from "livekit-client";
import type {
  LocalMedia,
  RtcRoom,
  RtcRoomEvents,
  ScreenShareOptions,
  TrackSource,
  TrackView,
  PeerStatus,
} from "./types";
import { t } from "../i18n";

/** Parses the hub identity "ts<clientId>". */
export function clientIdFromIdentity(identity: string): number | null {
  const m = /^ts(\d+)$/.exec(identity);
  return m ? Number(m[1]) : null;
}

export class LiveKitRoom implements RtcRoom {
  readonly kind = "livekit" as const;
  readonly peers: PeerStatus[] = [];

  private constructor(
    private readonly room: Room,
    private readonly events: RtcRoomEvents,
  ) {}

  static async connect(url: string, token: string, events: RtcRoomEvents): Promise<LiveKitRoom> {
    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room({ adaptiveStream: true, dynacast: true });
    const wrapper = new LiveKitRoom(room, events);
    const refresh = () => events.onChange();
    room
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (pub.source === "screen_share") events.onScreenEnded();
        refresh();
      })
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.Disconnected, refresh);
    await room.connect(url, token);
    return wrapper;
  }

  get cameraOn(): boolean {
    return this.room.localParticipant.isCameraEnabled;
  }

  get screenOn(): boolean {
    return this.room.localParticipant.isScreenShareEnabled;
  }

  get participantCount(): number {
    return this.room.remoteParticipants.size + 1;
  }

  get tracks(): TrackView[] {
    const out: TrackView[] = [];
    const collect = (p: Participant, isLocal: boolean) => {
      for (const pub of p.trackPublications.values()) {
        const track = pub.track;
        if (!track) continue;
        if (pub.kind !== "video" && pub.kind !== "audio") continue;
        out.push({
          sid: pub.trackSid,
          kind: pub.kind === "video" ? "video" : "audio",
          source: mapSource(pub.source),
          clientId: clientIdFromIdentity(p.identity),
          participantName: isLocal ? t("info.me") : p.name || p.identity,
          isLocal,
          attach: (el) => void (track as Track).attach(el),
          detach: (el) => void (track as Track).detach(el),
        });
      }
    };
    collect(this.room.localParticipant, true);
    for (const p of this.room.remoteParticipants.values()) collect(p, false);
    return out;
  }

  async setCamera(on: boolean): Promise<void> {
    await this.room.localParticipant.setCameraEnabled(on);
  }

  async setScreen(on: boolean, opts: ScreenShareOptions, stream?: MediaStream): Promise<void> {
    const lp = this.room.localParticipant;
    if (!on) {
      await lp.setScreenShareEnabled(false);
      return;
    }
    if (stream) {
      const { LocalVideoTrack, Track } = await import("livekit-client");
      const v = stream.getVideoTracks()[0];
      if (v) {
        const lt = new LocalVideoTrack(v, undefined, false);
        await lp.publishTrack(lt, { source: Track.Source.ScreenShare, name: "screen" });
      }
      return;
    }
    await lp.setScreenShareEnabled(true, {
      audio: opts.audio,
      contentHint: opts.contentHint,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: "include",
      resolution: opts.maxHeight
        ? {
            width: Math.round((opts.maxHeight * 16) / 9),
            height: opts.maxHeight,
            frameRate: opts.fps,
          }
        : undefined,
    });
  }

  detachLocalMedia(): LocalMedia {
    const lp = this.room.localParticipant;
    const take = (source: string): MediaStream | null => {
      for (const pub of lp.trackPublications.values()) {
        if (pub.source !== source || !pub.track) continue;
        const mst = pub.track.mediaStreamTrack;
        // stopOnUnpublish=false is the whole point: the capture stays live.
        void lp.unpublishTrack(pub.track, false);
        return mst ? new MediaStream([mst]) : null;
      }
      return null;
    };
    return { camera: take("camera"), screen: take("screen_share") };
  }

  async close(): Promise<void> {
    await this.room.disconnect();
  }
}

function mapSource(source: Track.Source): TrackSource {
  switch (source) {
    case "camera":
      return "camera";
    case "screen_share":
      return "screen";
    case "screen_share_audio":
      return "screen_audio";
    case "microphone":
      return "mic";
    default:
      return "unknown";
  }
}
