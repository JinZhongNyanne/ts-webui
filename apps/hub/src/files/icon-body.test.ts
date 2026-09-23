import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { iconIdOf } from "@jinz/protocol";
import { iconBytesMatchPath, readWholeBody } from "./icon-body.js";

const stall = { windowMs: 60_000, minBytes: 1 };

describe("readWholeBody", () => {
  it("reads exactly what was announced", async () => {
    const body = Buffer.from("hello icon");
    const read = await readWholeBody(Readable.from([body]), body.length, stall);
    expect(read).toEqual(body);
  });

  it("fails a body that is shorter or longer than announced", async () => {
    const body = Buffer.from("hello icon");
    await expect(readWholeBody(Readable.from([body]), 5, stall)).rejects.toThrow();
    await expect(readWholeBody(Readable.from([body]), 50, stall)).rejects.toThrow();
  });
});

describe("iconBytesMatchPath", () => {
  const bytes = Buffer.from("icon bytes");
  it("takes the file only under the id its bytes give it", () => {
    expect(iconBytesMatchPath(`/icon_${iconIdOf(bytes)}`, bytes)).toBe(true);
    expect(iconBytesMatchPath(`/icon_${iconIdOf(bytes)}`, Buffer.from("other"))).toBe(false);
    expect(iconBytesMatchPath("/icon_5000", bytes)).toBe(false);
    expect(iconBytesMatchPath("/notes.txt", bytes)).toBe(false);
  });

  it("reads the id the way the page writes it (CRC-32 unsigned)", () => {
    // A CRC above 2^31 travels negative in permissions, unsigned in the name.
    const big = Buffer.from("x");
    expect(iconIdOf(big)).toBeGreaterThan(2 ** 31);
    expect(iconBytesMatchPath(`/icon_${iconIdOf(big)}`, big)).toBe(true);
    expect(iconBytesMatchPath(`/icon_${iconIdOf(big) | 0}`, big)).toBe(false);
  });
});
