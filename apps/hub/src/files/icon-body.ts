/**
 * Icons are named by their bytes: `/icon_<CRC-32>`, and an existing name is
 * never overwritten (routes.ts). The server takes any id though, so anyone
 * with b_icon_manage could put a picture up under the name a future icon
 * would have and have it shown in its place. Icons are small (a few KiB, see
 * internal-limits.ts), so the hub reads one whole before starting the upload
 * and checks the name against the CRC-32 the page computed from the same
 * bytes (ts-internal-files.ts).
 */
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import { iconIdFromFileName, iconIdOf, isIconFilePath } from "@jinz/protocol";
import { ExactLength } from "./exact-length.js";
import { StallGuard, type StallLimits } from "./stall-guard.js";

/** Reads `expected` bytes from `source`; fails on anything else, or on a stall. */
export async function readWholeBody(
  source: NodeJS.ReadableStream,
  expected: number,
  stall: StallLimits,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(Buffer.from(chunk));
      done();
    },
  });
  await pipeline(source, new StallGuard(expected, stall), new ExactLength(expected), sink);
  return Buffer.concat(chunks);
}

/** Whether `bytes` are the icon `path` names (its CRC-32, unsigned, as the page writes it). */
export function iconBytesMatchPath(path: string, bytes: Buffer): boolean {
  if (!isIconFilePath(path)) return false;
  return iconIdFromFileName(path.slice(1)) === iconIdOf(bytes);
}
