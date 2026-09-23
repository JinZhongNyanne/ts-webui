/**
 * `detachLocalMedia()` is what lets a screen share survive a reconnect: the room
 * must hand the capture back with its tracks still live, where `setScreen(false)`
 * and `close()` both deliberately stop them.
 */
import { describe, expect, it, vi } from "vitest";
import { MeshRoom } from "./mesh";
import { DEFAULT_SCREEN_OPTIONS } from "./types";

interface FakeTrack {
  kind: string;
  id: string;
  contentHint: string;
  readyState: string;
  stopped: boolean;
  stop(): void;
  addEventListener(): void;
  removeEventListener(): void;
}

function fakeTrack(kind: string, id: string): FakeTrack {
  return {
    kind,
    id,
    contentHint: "",
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
    addEventListener() {},
    removeEventListener() {},
  };
}

function fakeStream(id: string, tracks: FakeTrack[]): MediaStream {
  return {
    id,
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
  } as unknown as MediaStream;
}

function makeRoom() {
  const room = new MeshRoom({
    selfClientId: 7,
    selfName: "Me",
    iceServers: [],
    send: vi.fn(),
    onChange: vi.fn(),
    onError: vi.fn(),
    onScreenEnded: vi.fn(),
  });
  return room;
}

describe("MeshRoom.detachLocalMedia", () => {
  it("returns the screen stream with its tracks still live", async () => {
    const track = fakeTrack("video", "screen-1");
    const stream = fakeStream("s1", [track]);
    const room = makeRoom();
    await room.setScreen(true, DEFAULT_SCREEN_OPTIONS, stream);
    expect(room.screenOn).toBe(true);

    const held = room.detachLocalMedia();
    expect(held.screen).toBe(stream);
    expect(track.stopped).toBe(false);
    expect(track.readyState).toBe("live");
  });

  it("leaves the room no longer publishing what it handed back", async () => {
    const stream = fakeStream("s1", [fakeTrack("video", "screen-1")]);
    const room = makeRoom();
    await room.setScreen(true, DEFAULT_SCREEN_OPTIONS, stream);
    room.detachLocalMedia();
    expect(room.screenOn).toBe(false);
  });

  it("does not stop a detached stream when the room is later closed", async () => {
    const track = fakeTrack("video", "screen-1");
    const stream = fakeStream("s1", [track]);
    const room = makeRoom();
    await room.setScreen(true, DEFAULT_SCREEN_OPTIONS, stream);
    const held = room.detachLocalMedia();
    await room.close();
    expect(held.screen).toBe(stream);
    expect(track.stopped).toBe(false);
  });

  it("still stops media that was never detached", async () => {
    const track = fakeTrack("video", "screen-1");
    const room = makeRoom();
    await room.setScreen(true, DEFAULT_SCREEN_OPTIONS, fakeStream("s1", [track]));
    await room.close();
    expect(track.stopped).toBe(true);
  });

  it("reports nothing to hand back when nothing is publishing", () => {
    const room = makeRoom();
    expect(room.detachLocalMedia()).toEqual({ camera: null, screen: null });
  });
});
