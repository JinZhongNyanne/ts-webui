import { describe, expect, it } from "vitest";
import { WHISPER_MAX_TARGETS } from "@jinz/protocol";
import { encodeWhisperPayload, keepVisibleTargets } from "./whisper.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("encodeWhisperPayload", () => {
  it("lays out id, codec, counts, channel ids, client ids and the voice, big-endian", () => {
    const out = encodeWhisperPayload({
      vid: 0x0102,
      codec: 4,
      channels: ["1", "258"],
      clients: [5, 0x0304],
      data: new Uint8Array([0xaa, 0xbb]),
    });
    expect(hex(out)).toBe(
      [
        "0102", // voice packet id
        "04", // codec (Opus voice)
        "02", // N channels
        "02", // M clients
        "0000000000000001",
        "0000000000000102",
        "0005",
        "0304",
        "aabb",
      ].join(""),
    );
  });

  it("carries a 64-bit channel id without losing precision", () => {
    const out = encodeWhisperPayload({
      vid: 0,
      codec: 5,
      channels: ["18446744073709551615"],
      clients: [],
      data: new Uint8Array(0),
    });
    expect(hex(out)).toBe("0000" + "05" + "01" + "00" + "ffffffffffffffff");
  });

  it("encodes the empty end-of-whisper frame", () => {
    const out = encodeWhisperPayload({
      vid: 7,
      codec: 4,
      channels: [],
      clients: [9],
      data: new Uint8Array(0),
    });
    expect(hex(out)).toBe("0007" + "04" + "00" + "01" + "0009");
  });

  it("refuses more targets than the anti-flood cap", () => {
    const clients = Array.from({ length: WHISPER_MAX_TARGETS }, (_, i) => i + 1);
    expect(() =>
      encodeWhisperPayload({ vid: 0, codec: 4, channels: [], clients, data: new Uint8Array(0) }),
    ).not.toThrow();
    expect(() =>
      encodeWhisperPayload({
        vid: 0,
        codec: 4,
        channels: ["1"],
        clients,
        data: new Uint8Array(0),
      }),
    ).toThrow(RangeError);
  });

  it("refuses a channel id that does not fit 64 bits", () => {
    expect(() =>
      encodeWhisperPayload({
        vid: 0,
        codec: 4,
        channels: ["18446744073709551616"],
        clients: [],
        data: new Uint8Array(0),
      }),
    ).toThrow(RangeError);
  });
});

describe("keepVisibleTargets", () => {
  const view = {
    selfId: 10,
    hasChannel: (id: string) => id === "1" || id === "2",
    hasClient: (id: number) => id === 10 || id === 11 || id === 12,
  };

  it("keeps channels in our tree and clients in view", () => {
    expect(keepVisibleTargets({ channels: ["1", "2"], clients: [11, 12] }, view)).toEqual({
      channels: ["1", "2"],
      clients: [11, 12],
    });
  });

  it("drops unknown channels, clients out of view and ourselves", () => {
    expect(keepVisibleTargets({ channels: ["1", "99"], clients: [10, 11, 500] }, view)).toEqual({
      channels: ["1"],
      clients: [11],
    });
  });

  it("drops duplicates, keeping the first", () => {
    expect(keepVisibleTargets({ channels: ["2", "1", "2"], clients: [12, 11, 12] }, view)).toEqual({
      channels: ["2", "1"],
      clients: [12, 11],
    });
  });

  it("normalises channel ids so '01' and '1' are one channel", () => {
    expect(keepVisibleTargets({ channels: ["01", "1"], clients: [] }, view)).toEqual({
      channels: ["1"],
      clients: [],
    });
  });
});
