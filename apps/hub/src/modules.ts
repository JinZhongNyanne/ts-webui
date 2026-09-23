/**
 * Extension point. Future features (e.g. Emby synchronized playback) plug in
 * here instead of touching the gateway:
 *
 *  - `registerRoutes` adds REST endpoints under /api/<name>/...
 *  - `roomState` contributes per-channel shared state, delivered to every web
 *    user in that channel as `room.state.ext[<name>]`
 *  - session hooks observe browser sessions coming and going
 */
import type { FastifyInstance } from "fastify";
import type { Session } from "./session/Session.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- accept any logger/type-provider flavour
export type AnyFastify = FastifyInstance<any, any, any, any, any>;

export interface RoomRef {
  /** "host:port" of the TeamSpeak server, lower-cased. */
  serverKey: string;
  channelId: string;
}

export interface HubModule {
  readonly name: string;
  registerRoutes?(app: AnyFastify): void;
  roomState?(room: RoomRef): unknown;
  onSessionOpen?(session: Session): void;
  onSessionClose?(session: Session): void;
  /** Called when a web user enters/leaves a channel room. */
  onRoomChange?(
    room: RoomRef,
    members: ReadonlyArray<{ clientId: number; nickname: string }>,
  ): void;
}
