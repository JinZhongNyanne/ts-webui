import { describe, expect, it } from "vitest";
import { bytesFrom, contentRange, parseRange, unsatisfiedRange } from "./range.js";

describe("parseRange", () => {
  it("serves the whole file when no range is asked for", () => {
    expect(parseRange(undefined, 100)).toEqual({ kind: "whole" });
  });

  it("answers an open-ended range from its start", () => {
    expect(parseRange("bytes=0-", 100)).toEqual({ kind: "from", start: 0 });
    expect(parseRange("bytes=42-", 100)).toEqual({ kind: "from", start: 42 });
    expect(parseRange("bytes=99-", 100)).toEqual({ kind: "from", start: 99 });
  });

  it("answers a closed range as open-ended: TeamSpeak has no end position", () => {
    expect(parseRange("bytes=10-19", 100)).toEqual({ kind: "from", start: 10 });
    expect(parseRange("bytes=10-10", 100)).toEqual({ kind: "from", start: 10 });
    expect(parseRange("bytes=10-5000", 100)).toEqual({ kind: "from", start: 10 });
  });

  it("answers a suffix range from where it starts", () => {
    expect(parseRange("bytes=-30", 100)).toEqual({ kind: "from", start: 70 });
    expect(parseRange("bytes=-500", 100)).toEqual({ kind: "from", start: 0 });
  });

  it("refuses a range that starts at or past the end", () => {
    expect(parseRange("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5000-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
  });

  it("serves an empty file whole, whatever range is asked for", () => {
    // A player's first request is `bytes=0-`; refusing it left a zero-byte
    // clip saying "link expired" or 416 instead of simply being empty.
    for (const header of ["bytes=0-", "bytes=5-", "bytes=-10", "bytes=-0", undefined]) {
      expect(parseRange(header, 0), String(header)).toEqual({ kind: "whole" });
    }
  });

  it("ignores what it cannot answer as one range, as RFC 9110 allows", () => {
    for (const header of [
      "bytes=0-1,5-6",
      "items=0-",
      "bytes=",
      "bytes=-",
      "bytes=a-",
      "bytes=20-10",
      "bytes=1e3-",
      "bytes=0x10-",
      "bytes=1234567890123456-",
      "bytes = 5-",
    ]) {
      expect(parseRange(header, 100), header).toEqual({ kind: "whole" });
    }
    expect(parseRange(["bytes=1-", "bytes=2-"], 100)).toEqual({ kind: "whole" });
  });
});

describe("Content-Range", () => {
  it("names the bytes from the start to the last one, out of the whole", () => {
    expect(contentRange(0, 100)).toBe("bytes 0-99/100");
    expect(contentRange(42, 100)).toBe("bytes 42-99/100");
    expect(unsatisfiedRange(100)).toBe("bytes */100");
  });
});

describe("bytesFrom", () => {
  it("reads the start's size as the whole file's, or as what is left of it", () => {
    expect(bytesFrom(100, 100, 0)).toBe(100);
    expect(bytesFrom(100, 100, 40)).toBe(60);
    expect(bytesFrom(60, 100, 40)).toBe(60);
  });

  it("says null when the file is no longer the one the link was minted for", () => {
    expect(bytesFrom(120, 100, 40)).toBeNull();
    expect(bytesFrom(99, 100, 0)).toBeNull();
    expect(bytesFrom(100, 100, 100)).toBeNull();
    expect(bytesFrom(3, 0, 0)).toBeNull();
  });

  it("reads an empty file from its start as nothing to send", () => {
    expect(bytesFrom(0, 0, 0)).toBe(0);
  });
});
