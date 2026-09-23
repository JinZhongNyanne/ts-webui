/**
 * The TeamSpeak side of whispering: which targets a session may whisper to,
 * and the packet body that carries one whispered voice frame to them.
 *
 * Pure, so the byte layout can be pinned against a fixture. The layout of a
 * client -> server VoiceWhisper body (all big-endian):
 *
 *   u16 voice packet id, u8 codec, u8 N, u8 M,
 *   N × u64 channel id, M × u16 client id, then the Opus frame.
 *
 * Verified against a live TS3 server: sent through the driver's generic
 * `handler.sendPacket` with the Unencrypted flag, the server delivers the
 * frame to exactly the named channels and clients, and they receive it as
 * packet type VoiceWhisper with the same body as ordinary voice.
 */
import { WHISPER_MAX_TARGETS, type WhisperTarget } from "@jinz/protocol";

/** TeamSpeak packet type of a whispered voice frame (`PacketType.VoiceWhisper`). */
export const PACKET_TYPE_VOICE_WHISPER = 1;
/**
 * Voice travels with the Unencrypted flag and the fake signature, like the
 * driver's own `sendVoicePacket`; the server rejects nothing else for voice.
 */
export const PACKET_FLAG_UNENCRYPTED = 0x80;

const HEAD_BYTES = 5;
const CHANNEL_ID_BYTES = 8;
const CLIENT_ID_BYTES = 2;
const U64_MAX = (1n << 64n) - 1n;

export interface WhisperPayload {
  /** The voice packet id; the server does not check it, but real clients count it up. */
  vid: number;
  codec: number;
  /** Decimal channel ids (u64 on the wire). */
  channels: readonly string[];
  clients: readonly number[];
  /** One Opus frame; empty ends the whisper, like end-of-talk. */
  data: Uint8Array;
}

/** Builds the body of one VoiceWhisper packet. Throws a RangeError for anything the wire cannot carry. */
export function encodeWhisperPayload(p: WhisperPayload): Uint8Array {
  const n = p.channels.length;
  const m = p.clients.length;
  if (n + m > WHISPER_MAX_TARGETS) {
    throw new RangeError(`at most ${WHISPER_MAX_TARGETS} whisper targets, got ${n + m}`);
  }
  const out = new Uint8Array(
    HEAD_BYTES + n * CHANNEL_ID_BYTES + m * CLIENT_ID_BYTES + p.data.byteLength,
  );
  const view = new DataView(out.buffer);
  view.setUint16(0, p.vid & 0xffff);
  out[2] = p.codec & 0xff;
  out[3] = n;
  out[4] = m;
  let at = HEAD_BYTES;
  for (const id of p.channels) {
    view.setBigUint64(at, channelIdToU64(id));
    at += CHANNEL_ID_BYTES;
  }
  for (const id of p.clients) {
    if (!Number.isInteger(id) || id < 0 || id > 0xffff) {
      throw new RangeError(`client id out of range: ${id}`);
    }
    view.setUint16(at, id);
    at += CLIENT_ID_BYTES;
  }
  out.set(p.data, at);
  return out;
}

function channelIdToU64(id: string): bigint {
  if (!/^\d+$/.test(id)) throw new RangeError(`channel id is not decimal: ${id}`);
  const value = BigInt(id);
  if (value > U64_MAX) throw new RangeError(`channel id does not fit 64 bits: ${id}`);
  return value;
}

/** What a session can see: its channel tree and the clients in view. */
export interface WhisperView {
  selfId: number;
  hasChannel: (channelId: string) => boolean;
  hasClient: (clientId: number) => boolean;
}

/**
 * The part of a requested target this session may actually whisper to:
 * channels in its own tree and clients it can see, never itself, each once.
 * A browser can name any id it likes; this keeps the hub from being used to
 * probe or address anything its TeamSpeak client does not already know of.
 */
export function keepVisibleTargets(target: WhisperTarget, view: WhisperView): WhisperTarget {
  const channels: string[] = [];
  for (const raw of target.channels) {
    const id = normaliseChannelId(raw);
    if (id !== null && view.hasChannel(id) && !channels.includes(id)) channels.push(id);
  }
  const clients: number[] = [];
  for (const id of target.clients) {
    if (id !== view.selfId && view.hasClient(id) && !clients.includes(id)) clients.push(id);
  }
  return { channels, clients };
}

/** "007" names channel 7; the tree keys channels by their canonical decimal form. */
function normaliseChannelId(raw: string): string | null {
  if (!/^\d+$/.test(raw)) return null;
  return BigInt(raw).toString();
}
