/**
 * LiveKit access tokens. A room is bound to one TeamSpeak channel on one server,
 * so web users only ever see video from people in their own channel.
 */
import { AccessToken } from "livekit-server-sdk";
import type { Config } from "../config.js";

export interface RtcIdentity {
  clientId: number;
  nickname: string;
  uid: string;
}

export function roomNameFor(host: string, port: number, channelId: string): string {
  return `ts:${host.toLowerCase()}:${port}/ch:${channelId}`;
}

/** Room name on a hub with HUB_TS_SERVER: the page must not learn the address. */
export function fixedServerRoomName(channelId: string): string {
  return `ts:fixed/ch:${channelId}`;
}

export class LiveKitService {
  constructor(private readonly config: Config) {}

  get publicUrl(): string {
    return this.config.LIVEKIT_PUBLIC_URL || this.config.LIVEKIT_URL;
  }

  async mintToken(room: string, who: RtcIdentity): Promise<string> {
    const at = new AccessToken(this.config.LIVEKIT_API_KEY, this.config.LIVEKIT_API_SECRET, {
      identity: `ts${who.clientId}`,
      name: who.nickname,
      // Long enough for a session to sit in one channel, short enough that a
      // leaked token is not a standing invitation to the room.
      ttl: "1h",
      metadata: JSON.stringify({ clientId: who.clientId, uid: who.uid }),
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return at.toJwt();
  }
}
