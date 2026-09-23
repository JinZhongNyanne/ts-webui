/**
 * Taps the library's packet handler to observe EVERY server command,
 * including the welcome sequence (channellist rows) and notifications the
 * library does not expose as typed events (channel edits, client updates...).
 *
 * The tap is read-only: the original handler still runs afterwards.
 */
import type { Client } from "@honeybbq/teamspeak-client";
import { unescape } from "@honeybbq/teamspeak-client/command";

export interface RawCommand {
  name: string;
  params: Record<string, string>;
  /** Position of this row within its command ("a|b|c" gives 0, 1, 2). */
  segment: number;
}

/** Low nibble of typeFlagged for command packets. */
const PACKET_COMMAND = 2;
const PACKET_COMMAND_LOW = 3;

export function tapRawCommands(client: Client, onCommand: (cmd: RawCommand) => void): () => void {
  const handler = client.handler;
  const original = handler.onPacket;
  handler.onPacket = (packet) => {
    const type = packet.typeFlagged & 0x0f;
    if ((type === PACKET_COMMAND || type === PACKET_COMMAND_LOW) && packet.data.length > 0) {
      try {
        const text = Buffer.from(packet.data).toString("utf8");
        for (const cmd of parseCommandLines(text)) onCommand(cmd);
      } catch {
        // never let a tap failure break the library's own processing
      }
    }
    original?.(packet);
  };
  return () => {
    handler.onPacket = original;
  };
}

/** Splits a raw command payload into rows; multi-row commands ("a|b") share the command name. */
export function parseCommandLines(text: string): RawCommand[] {
  const out: RawCommand[] = [];
  for (const rawLine of text.split(/\0|\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line) continue;
    const firstSpace = line.indexOf(" ");
    let name: string;
    let rest: string;
    if (firstSpace < 0) {
      name = line;
      rest = "";
    } else {
      name = line.slice(0, firstSpace);
      rest = line.slice(firstSpace + 1);
    }
    // Command names never contain "=": a leading key=value means the row has no name.
    if (name.includes("=")) {
      name = "";
      rest = line;
    }
    // In a batched notify (e.g. notifycliententerview a|b|c), TS3 writes the
    // shared channel/invoker context only on the first segment; later segments
    // carry only per-item fields. Propagate those shared keys so every item in
    // the batch keeps the right channel. List commands (channellist/clientlist)
    // do not use this encoding, so only a small whitelist of context keys is
    // inherited to avoid leaking per-row values.
    const segments = rest.split("|");
    let shared: Record<string, string> | null = null;
    for (let i = 0; i < segments.length; i++) {
      const params = parseParams(segments[i]!);
      if (i === 0) {
        shared = pickSharedContext(params);
      } else if (shared) {
        for (const [k, v] of Object.entries(shared)) {
          if (!(k in params)) params[k] = v;
        }
      }
      out.push({ name, params, segment: i });
    }
  }
  return out;
}

/** Command-level context keys that TS3 emits once for a whole batched notify. */
const SHARED_CONTEXT_KEYS = new Set([
  "ctid",
  "cfid",
  "reasonid",
  "reasonmsg",
  "invokerid",
  "invokername",
  "invokeruid",
]);

function pickSharedContext(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of SHARED_CONTEXT_KEYS) {
    if (key in params) out[key] = params[key]!;
  }
  return out;
}

export function parseParams(row: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const token of row.split(" ")) {
    if (!token) continue;
    const eq = token.indexOf("=");
    if (eq < 0) {
      params[unescape(token)] = "";
    } else {
      params[unescape(token.slice(0, eq))] = unescape(token.slice(eq + 1));
    }
  }
  return params;
}
