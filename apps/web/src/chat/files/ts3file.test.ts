import { describe, expect, it } from "vitest";
import {
  FILE_MESSAGE_MAX_CHARS,
  buildFileMessage,
  buildTs3FileUrl,
  encodeQueryValue,
  parseTs3FileUrl,
  type Ts3FileRef,
} from "./ts3file";

const ref = (over: Partial<Ts3FileRef> = {}): Ts3FileRef => ({
  host: "ts.example.com",
  port: 9987,
  cid: "5",
  path: "/report.pdf",
  size: 1536,
  datetime: 1758300000,
  ...over,
});

describe("buildTs3FileUrl", () => {
  it("writes the TS3 client's parameters in its order", () => {
    expect(buildTs3FileUrl(ref())).toBe(
      "ts3file://ts.example.com?port=9987&channel=5&path=/&filename=report.pdf&isDir=0&size=1536&fileDateTime=1758300000",
    );
  });

  it("puts the folder in path and the name in filename", () => {
    expect(buildTs3FileUrl(ref({ path: "/docs/sub/a.txt" }))).toContain(
      "&path=/docs/sub&filename=a.txt&",
    );
  });

  it("includes the server UID when known, encoded", () => {
    expect(buildTs3FileUrl(ref({ serverUid: "ab+/c=" }))).toContain(
      "?port=9987&serverUID=ab%2B/c%3D&channel=5&",
    );
  });

  it("leaves the date out when unknown", () => {
    expect(buildTs3FileUrl(ref({ datetime: undefined }))).toMatch(/&size=1536$/);
  });

  it("falls back to localhost for a host that cannot go into a BBCode tag", () => {
    expect(buildTs3FileUrl(ref({ host: "[::1]" }))).toMatch(/^ts3file:\/\/localhost\?/);
    expect(buildTs3FileUrl(ref({ host: "" }))).toMatch(/^ts3file:\/\/localhost\?/);
  });
});

describe("encodeQueryValue", () => {
  it("encodes what would end the value, the tag or the URL", () => {
    expect(encodeQueryValue("a b&c=d#e+f%g[h]i\"j'k")).toBe(
      "a%20b%26c%3Dd%23e%2Bf%25g%5Bh%5Di%22j'k",
    );
  });

  it("keeps slashes and non-ASCII text as they are (like TS3's pretty URLs)", () => {
    expect(encodeQueryValue("/报告/résumé.txt")).toBe("/报告/résumé.txt");
  });

  it("encodes control characters", () => {
    expect(encodeQueryValue("a\u0001\u007f")).toBe("a%01%7F");
  });
});

describe("parseTs3FileUrl", () => {
  it("refuses channel ids the hub would refuse (leading zeros)", () => {
    const link = (cid: string) =>
      `ts3file://example.com?port=9987&channel=${cid}&path=/&filename=a.txt&isDir=0&size=1&fileDateTime=0`;
    expect(parseTs3FileUrl(link("00"))).toBeNull();
    expect(parseTs3FileUrl(link("007"))).toBeNull();
    expect(parseTs3FileUrl(link("0"))?.cid).toBe("0");
  });

  it("reads a link as the TS3 client writes it", () => {
    expect(
      parseTs3FileUrl(
        "ts3file://example.com?port=9987&serverUID=xwBgkKOmijLSIK7o4ULBbGx4c0o=&channel=1&path=/&filename=222168253108.jpg&isDir=0&size=91319&fileDateTime=1716445847",
      ),
    ).toEqual({
      host: "example.com",
      port: 9987,
      serverUid: "xwBgkKOmijLSIK7o4ULBbGx4c0o=",
      cid: "1",
      path: "/222168253108.jpg",
      size: 91319,
      datetime: 1716445847,
    });
  });

  it("round-trips odd names", () => {
    for (const name of [
      "a b.txt",
      "100% [final] & more=+#.zip",
      "报告 2026.pdf",
      "'quoted' \"double\".txt",
      "no-extension",
      ".hidden",
    ]) {
      const built = buildTs3FileUrl(ref({ path: `/dir x/${name}` }));
      expect(parseTs3FileUrl(built)?.path, name).toBe(`/dir x/${name}`);
    }
  });

  it("accepts a percent-encoded path, a missing date and any case", () => {
    expect(
      parseTs3FileUrl("TS3FILE://h?channel=12&path=%2Fa%2Fb&filename=x%20y.txt&isDir=0&size=4"),
    ).toEqual({ host: "h", port: 9987, cid: "12", path: "/a/b/x y.txt", size: 4 });
  });

  it("keeps a plus sign (TS3 does not write spaces as +)", () => {
    expect(parseTs3FileUrl("ts3file://h?channel=1&path=/&filename=c++.txt")?.path).toBe("/c++.txt");
  });

  it("keeps a broken escape as typed", () => {
    expect(parseTs3FileUrl("ts3file://h?channel=1&path=/&filename=100%.txt")?.path).toBe(
      "/100%.txt",
    );
  });

  it.each([
    ["another scheme", "http://h?channel=1&path=/&filename=a"],
    ["no channel", "ts3file://h?path=/&filename=a"],
    ["a channel that is not a number", "ts3file://h?channel=1x&path=/&filename=a"],
    ["no file name", "ts3file://h?channel=1&path=/"],
    ["a folder", "ts3file://h?channel=1&path=/&filename=a&isDir=1"],
    ["dot segments", "ts3file://h?channel=1&path=/../x&filename=a"],
    ["a name with a slash", "ts3file://h?channel=1&path=/&filename=a%2Fb"],
    ["a name that is ..", "ts3file://h?channel=1&path=/&filename=.."],
    ["a control character", "ts3file://h?channel=1&path=/&filename=a%0Ab"],
    ["a backslash", "ts3file://h?channel=1&path=/&filename=a%5Cb"],
    ["no query", "ts3file://h"],
  ])("refuses %s", (_what, url) => {
    expect(parseTs3FileUrl(url)).toBeNull();
  });

  it("ignores a size or port that is not a number", () => {
    expect(
      parseTs3FileUrl("ts3file://h?port=x&channel=1&path=/&filename=a&size=-3&fileDateTime=z"),
    ).toEqual({ host: "h", port: 9987, cid: "1", path: "/a" });
  });
});

describe("buildFileMessage", () => {
  it("is a TS3 [URL] tag labelled with the file name", () => {
    const msg = buildFileMessage(ref());
    expect(msg).toBe(`[URL=${buildTs3FileUrl(ref())}]report.pdf[/URL]`);
  });

  it("keeps brackets out of the label, so it cannot open or close tags", () => {
    const msg = buildFileMessage(ref({ path: "/[b]x[URL].txt" }))!;
    expect(msg).toMatch(/\]\(b\)x\(URL\)\.txt\[\/URL\]$/);
    expect(parseTs3FileUrl(msg.slice(5, msg.indexOf("]")))?.path).toBe("/[b]x[URL].txt");
  });

  it("fits in the limit: shortens the label, then drops the date", () => {
    const long = `/${"x".repeat(250)}.txt`;
    const full = buildFileMessage(ref({ path: long }), 10_000)!;
    const limit = full.length - 100;
    const msg = buildFileMessage(ref({ path: long }), limit)!;
    expect(msg.length).toBeLessThanOrEqual(limit);
    expect(msg).toContain("…");
    expect(msg).toMatch(/\.txt\[\/URL\]$/);
    expect(parseTs3FileUrl(msg.slice(5, msg.indexOf("]")))?.path).toBe(long);
  });

  it("returns null when even the link alone is too long", () => {
    expect(buildFileMessage(ref(), 40)).toBeNull();
  });

  it("stays under TS3's 1024 characters for the longest name the server takes", () => {
    const name = `${"報".repeat(251)}.txt`;
    const msg = buildFileMessage(ref({ path: `/${name}` }));
    expect(msg).not.toBeNull();
    expect(msg!.length).toBeLessThanOrEqual(FILE_MESSAGE_MAX_CHARS);
  });
});
