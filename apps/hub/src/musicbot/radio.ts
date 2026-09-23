/**
 * Personal FM and recommendations play in order.
 *
 * The bot starts FM in shuffle, and nothing stops anyone switching a
 * recommendation to shuffle either, but both are lists someone already put in
 * an order. The hub remembers, per bot, that one of them is playing, sets the
 * bot to sequential and refuses any other mode until something else replaces
 * the queue. The bot has no such notion (its FM flag is not in its status), so
 * this tracks what went through the hub; a queue replaced from the bot's own
 * UI or a chat command ends the lock only once the queue runs empty.
 *
 * Pure module: the state lives on the bridge.
 */
import type { MusicRadio } from "@jinz/protocol";
import type { ProxyResult } from "./BotBridge.js";

export const LOCKED_MODE = "seq";

/** Player actions that throw away the queue and whatever was playing. */
const REPLACING = new Set(["play", "play-song", "play-playlist", "play-album", "clear", "stop"]);

const PLAYER_ACTION = /^\/player\/([^/]+)\/([a-z-]+)$/;

function playerAction(path: string): { botId: string; action: string } | null {
  const m = PLAYER_ACTION.exec(path);
  return m ? { botId: m[1]!, action: m[2]! } : null;
}

/** The bot reports some refusals as HTTP 200 with `ok: false`. */
export function succeeded(result: ProxyResult): boolean {
  if (result.status < 200 || result.status >= 300) return false;
  const body = result.body as { ok?: unknown } | null;
  return body?.ok !== false;
}

function field(body: unknown, key: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[key] : null;
}

/**
 * How a finished proxy call changes a bot's radio: started, ended (`radio:
 * null`), or untouched (null). `path` is the readable sub-path, e.g.
 * `/player/<id>/fm`.
 */
export function radioTransition(
  method: string,
  path: string,
  body: unknown,
  result: ProxyResult,
): { botId: string; radio: MusicRadio | null } | null {
  if (method !== "POST") return null;
  const call = playerAction(path);
  if (!call || !succeeded(result)) return null;
  if (call.action === "fm") return { botId: call.botId, radio: "fm" };
  // The browser marks a recommended playlist; the bot ignores the extra field.
  if (call.action === "play-playlist" && field(body, "radio") === "recommend") {
    return { botId: call.botId, radio: "recommend" };
  }
  return REPLACING.has(call.action) ? { botId: call.botId, radio: null } : null;
}

/** An error code when this call would leave sequential mode during a radio. */
export function modeRefusal(
  method: string,
  path: string,
  body: unknown,
  radioOf: (botId: string) => MusicRadio | null,
): string | null {
  if (method !== "POST") return null;
  const call = playerAction(path);
  if (!call || call.action !== "mode") return null;
  if (radioOf(call.botId) === null) return null;
  return field(body, "mode") === LOCKED_MODE ? null : "music.modeLocked";
}
