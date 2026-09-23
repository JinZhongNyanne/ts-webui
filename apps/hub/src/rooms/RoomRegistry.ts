/**
 * Tracks which web sessions sit in which TeamSpeak channel and pushes a shared
 * `room.state` to everyone in the same channel. Native TS clients are not part
 * of this; it is the coordination layer for web-only features (video presence,
 * future Emby sync, ...).
 */
import type { RoomState, RoomVideoMember, RoomVideoPublisher } from "@jinz/protocol";
import type { HubModule, RoomRef } from "../modules.js";
import type { Session } from "../session/Session.js";

export interface RoomMember {
  session: Session;
  clientId: number;
  nickname: string;
  /** Joined the channel's video room (mesh peers only connect to these). */
  video: boolean;
  camera: boolean;
  screen: boolean;
}

interface Placement extends RoomRef {
  member: RoomMember;
}

export function serverKeyOf(host: string, port: number): string {
  return `${host.toLowerCase()}:${port}`;
}

export class RoomRegistry {
  /** serverKey -> channelId -> sessionId -> member */
  private readonly rooms = new Map<string, Map<string, Map<string, RoomMember>>>();
  private readonly bySession = new Map<string, Placement>();

  constructor(private readonly modules: HubModule[] = []) {}

  join(ref: RoomRef, member: RoomMember): void {
    const prev = this.bySession.get(member.session.id);
    if (prev && (prev.serverKey !== ref.serverKey || prev.channelId !== ref.channelId)) {
      this.removeFrom(prev, member.session.id);
      this.broadcast(prev);
    }
    const channels = this.rooms.get(ref.serverKey) ?? new Map<string, Map<string, RoomMember>>();
    this.rooms.set(ref.serverKey, channels);
    const members = channels.get(ref.channelId) ?? new Map<string, RoomMember>();
    channels.set(ref.channelId, members);
    const existing = members.get(member.session.id);
    members.set(
      member.session.id,
      existing
        ? {
            ...existing,
            ...member,
            video: existing.video,
            camera: existing.camera,
            screen: existing.screen,
          }
        : member,
    );
    this.bySession.set(member.session.id, { ...ref, member: members.get(member.session.id)! });
    this.broadcast(ref);
  }

  leave(sessionId: string): void {
    const prev = this.bySession.get(sessionId);
    if (!prev) return;
    this.removeFrom(prev, sessionId);
    this.bySession.delete(sessionId);
    this.broadcast(prev);
  }

  setPublishing(sessionId: string, camera: boolean, screen: boolean): void {
    const member = this.memberOf(sessionId);
    if (!member) return;
    const video = member.video || camera || screen;
    if (member.camera === camera && member.screen === screen && member.video === video) return;
    member.camera = camera;
    member.screen = screen;
    member.video = video;
    this.broadcast(this.bySession.get(sessionId)!);
  }

  /** Marks a session as (not) taking part in its channel's video room. */
  setVideo(sessionId: string, on: boolean): void {
    const member = this.memberOf(sessionId);
    if (!member) return;
    if (member.video === on && (on || (!member.camera && !member.screen))) return;
    member.video = on;
    if (!on) {
      member.camera = false;
      member.screen = false;
    }
    this.broadcast(this.bySession.get(sessionId)!);
  }

  /** The video-room mate with this TS client id, for relaying mesh signalling. */
  peerOf(sessionId: string, clientId: number): RoomMember | null {
    const p = this.bySession.get(sessionId);
    if (!p) return null;
    const room = this.rooms.get(p.serverKey)?.get(p.channelId);
    const self = room?.get(sessionId);
    if (!room || !self?.video) return null;
    for (const m of room.values()) {
      if (m.clientId === clientId && m.session.id !== sessionId) return m.video ? m : null;
    }
    return null;
  }

  private memberOf(sessionId: string): RoomMember | null {
    const p = this.bySession.get(sessionId);
    if (!p) return null;
    return this.rooms.get(p.serverKey)?.get(p.channelId)?.get(sessionId) ?? null;
  }

  stateOf(ref: RoomRef): RoomState {
    const members = this.rooms.get(ref.serverKey)?.get(ref.channelId);
    const publishers: RoomVideoPublisher[] = [];
    const videoMembers: RoomVideoMember[] = [];
    for (const m of members?.values() ?? []) {
      if (m.video) videoMembers.push({ clientId: m.clientId, nickname: m.nickname });
      if (m.camera || m.screen) {
        publishers.push({
          clientId: m.clientId,
          nickname: m.nickname,
          camera: m.camera,
          screen: m.screen,
        });
      }
    }
    const ext: Record<string, unknown> = {};
    for (const mod of this.modules) {
      if (mod.roomState) {
        try {
          ext[mod.name] = mod.roomState(ref);
        } catch {
          /* a broken module must not break room state */
        }
      }
    }
    return { channelId: ref.channelId, video: { publishers, members: videoMembers }, ext };
  }

  /** Re-broadcasts a room, e.g. after a module changed its ext state. */
  touch(ref: RoomRef): void {
    this.broadcast(ref);
  }

  private removeFrom(ref: RoomRef, sessionId: string): void {
    const channels = this.rooms.get(ref.serverKey);
    const members = channels?.get(ref.channelId);
    members?.delete(sessionId);
    if (members && members.size === 0) channels?.delete(ref.channelId);
    if (channels && channels.size === 0) this.rooms.delete(ref.serverKey);
  }

  private broadcast(ref: RoomRef): void {
    const members = this.rooms.get(ref.serverKey)?.get(ref.channelId);
    if (!members || members.size === 0) {
      for (const mod of this.modules) mod.onRoomChange?.(ref, []);
      return;
    }
    const state = this.stateOf(ref);
    for (const m of members.values()) m.session.send({ type: "room.state", state });
    const list = [...members.values()].map((m) => ({ clientId: m.clientId, nickname: m.nickname }));
    for (const mod of this.modules) mod.onRoomChange?.(ref, list);
  }
}
