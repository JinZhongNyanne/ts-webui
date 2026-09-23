import { describe, expect, it } from "vitest";
import { ftDeleteText, ftInitDownloadText, ftInitUploadText } from "./ft-init.js";

describe("transfer init commands", () => {
  it("download: hashed password, our id, from the start", () => {
    expect(ftInitDownloadText(40001, { cid: "5", path: "/sub dir/a b.txt", cpw: "secret" })).toBe(
      "ftinitdownload clientftfid=40001 name=\\/sub\\sdir\\/a\\sb.txt cid=5" +
        " cpw=5en6G6MezRroT3XKqkdPOmY\\/BfQ= seekpos=0",
    );
  });

  it("download: part-way in, from a media range request's start", () => {
    expect(ftInitDownloadText(40004, { cid: "5", path: "/v.webm", cpw: "", seekpos: 12_345 })).toBe(
      "ftinitdownload clientftfid=40004 name=\\/v.webm cid=5 cpw= seekpos=12345",
    );
    expect(ftInitDownloadText(40005, { cid: "5", path: "/v.webm", cpw: "", seekpos: 0 })).toContain(
      "seekpos=0",
    );
  });

  it("download: refuses a seek position that is not a byte offset", () => {
    for (const seekpos of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() =>
        ftInitDownloadText(1, { cid: "5", path: "/v.webm", cpw: "", seekpos }),
      ).toThrow();
    }
  });

  it("upload: size and overwrite, never resume", () => {
    expect(
      ftInitUploadText(40002, { cid: "1", path: "/a.txt", cpw: "", size: 11, overwrite: true }),
    ).toBe("ftinitupload clientftfid=40002 name=\\/a.txt cid=1 cpw= size=11 overwrite=1 resume=0");
    expect(
      ftInitUploadText(40003, { cid: "1", path: "/a.txt", cpw: "", size: 0, overwrite: false }),
    ).toContain("size=0 overwrite=0 resume=0");
  });

  it("delete: one file", () => {
    expect(ftDeleteText({ cid: "5", path: "/a.txt", cpw: "" })).toBe(
      "ftdeletefile cid=5 cpw= name=\\/a.txt",
    );
  });

  it("refuses a path the checks would not pass", () => {
    expect(() => ftInitDownloadText(1, { cid: "5", path: "/../x", cpw: "" })).toThrow();
    expect(() => ftInitDownloadText(1, { cid: "5x", path: "/x", cpw: "" })).toThrow();
    expect(() =>
      ftInitUploadText(1, { cid: "5", path: "/x", cpw: "", size: -1, overwrite: false }),
    ).toThrow();
  });
});
