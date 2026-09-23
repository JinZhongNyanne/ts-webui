import { describe, expect, it } from "vitest";
import { parseFileInfo, parseFileList } from "./file-list";
import { checkUpload, uploadLimit, uploadTarget } from "./upload-check";
import { FileTransferError, errorFromResponse } from "./http";

describe("parseFileList", () => {
  it("reads notifyfilelist rows, folders first, then by name", () => {
    const rows = [
      { cid: "5", path: "/", name: "b.txt", size: "11", datetime: "1789846714", type: "1" },
      { name: "sub dir", size: "0", datetime: "1789846713", type: "0" },
      { name: "A.txt", size: "3", datetime: "1", type: "1" },
      { size: "3" },
    ];
    expect(parseFileList(rows)).toEqual([
      { name: "sub dir", size: 0, datetime: 1789846713, isDir: true },
      { name: "A.txt", size: 3, datetime: 1, isDir: false },
      { name: "b.txt", size: 11, datetime: 1789846714, isDir: false },
    ]);
  });

  it("is empty for no rows (an empty folder)", () => expect(parseFileList([])).toEqual([]));
});

describe("parseFileInfo", () => {
  it("reads notifyfileinfo", () => {
    expect(parseFileInfo([{ cid: "5", name: "/d/a b.txt", size: "11", datetime: "7" }])).toEqual({
      path: "/d/a b.txt",
      name: "a b.txt",
      size: 11,
      datetime: 7,
    });
    expect(parseFileInfo([])).toBeNull();
  });
});

describe("upload checks", () => {
  const MB = 1024 * 1024;

  it("limit: the hub's, or the quota when smaller and known", () => {
    expect(uploadLimit(100 * MB, undefined)).toBe(100 * MB);
    expect(uploadLimit(100 * MB, -1)).toBe(100 * MB);
    expect(uploadLimit(100 * MB, 5)).toBe(5 * MB);
    // An old hub that sends no limits: only the quota, if any, applies.
    expect(uploadLimit(undefined, undefined)).toBe(Number.POSITIVE_INFINITY);
  });

  it("names what is wrong before anything is sent", () => {
    expect(checkUpload(10, 100)).toBeNull();
    expect(checkUpload(101, 100)).toBe("tooLarge");
  });

  it("builds the target path from a folder and a browser file name", () => {
    expect(uploadTarget("/", "a.txt")).toBe("/a.txt");
    expect(uploadTarget("/sub dir", "C:\\x\\b.txt")).toBe("/sub dir/C__x_b.txt");
    expect(uploadTarget("/../x", "a.txt")).toBeNull();
    expect(uploadTarget("/", "..")).toBeNull();
  });
});

describe("errorFromResponse", () => {
  it("translates the hub's text code and keeps the TeamSpeak code", () => {
    const err = errorFromResponse(403, {
      error: "2568",
      message: 'tsErr.missingPermission\x01{"perm":"i_ft_needed_file_upload_power"}',
      failedPermission: "i_ft_needed_file_upload_power",
    });
    expect(err).toBeInstanceOf(FileTransferError);
    expect(err.code).toBe("2568");
    expect(err.failedPermission).toBe("i_ft_needed_file_upload_power");
    expect(err.message).toContain("i_ft_needed_file_upload_power");
  });

  it("falls back on the status when the body is not ours", () => {
    expect(errorFromResponse(403, { error: "forbidden origin" }).code).toBe("http_403");
    expect(errorFromResponse(502, "oops").message.length).toBeGreaterThan(0);
  });
});
