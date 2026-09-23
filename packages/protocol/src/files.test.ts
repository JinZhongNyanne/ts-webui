import { describe, expect, it } from "vitest";
import {
  FT_NAME_MAX,
  FT_PATH_MAX,
  FtDownloadRequestSchema,
  FtUploadQuerySchema,
  formatBytes,
  ftMediaMimeOf,
  ftDirOf,
  ftNameOf,
  isFtName,
  joinFtPath,
  normalizeFtFilePath,
  normalizeFtPath,
  sanitizeFtFileName,
} from "./files.js";

describe("normalizeFtPath", () => {
  it("keeps the root and plain paths", () => {
    expect(normalizeFtPath("/")).toBe("/");
    expect(normalizeFtPath("/a/b.txt")).toBe("/a/b.txt");
    expect(normalizeFtPath("/sub dir/hello w.txt")).toBe("/sub dir/hello w.txt");
    expect(normalizeFtPath("/文件/图.png")).toBe("/文件/图.png");
  });

  it("drops empty segments and a trailing slash", () => {
    expect(normalizeFtPath("//a///b/")).toBe("/a/b");
  });

  it("must start at the root", () => {
    expect(normalizeFtPath("a/b")).toBeNull();
    expect(normalizeFtPath("")).toBeNull();
  });

  it("refuses dot segments instead of resolving them", () => {
    expect(normalizeFtPath("/a/../b")).toBeNull();
    expect(normalizeFtPath("/..")).toBeNull();
    expect(normalizeFtPath("/a/./b")).toBeNull();
  });

  it("refuses control characters, NUL and backslashes", () => {
    expect(normalizeFtPath("/a\x00b")).toBeNull();
    expect(normalizeFtPath("/a\nb")).toBeNull();
    expect(normalizeFtPath("/a\x7fb")).toBeNull();
    expect(normalizeFtPath("/a\\..\\b")).toBeNull();
  });

  it("refuses blank segments", () => {
    expect(normalizeFtPath("/ /b")).toBeNull();
  });

  it("caps segment and path length", () => {
    expect(normalizeFtPath(`/${"x".repeat(FT_NAME_MAX)}`)).not.toBeNull();
    expect(normalizeFtPath(`/${"x".repeat(FT_NAME_MAX + 1)}`)).toBeNull();
    const long = `/${Array.from({ length: 200 }, () => "ab").join("/")}`;
    expect(long.length).toBeGreaterThan(FT_PATH_MAX);
    expect(normalizeFtPath(long)).toBeNull();
  });

  it("refuses non-strings", () => {
    expect(normalizeFtPath(undefined as unknown as string)).toBeNull();
  });
});

describe("normalizeFtFilePath", () => {
  it("is a path that names something below the root", () => {
    expect(normalizeFtFilePath("/a.txt")).toBe("/a.txt");
    expect(normalizeFtFilePath("/")).toBeNull();
    expect(normalizeFtFilePath("//")).toBeNull();
  });
});

describe("path helpers", () => {
  it("joins a directory and a name", () => {
    expect(joinFtPath("/", "a.txt")).toBe("/a.txt");
    expect(joinFtPath("/d/", "a.txt")).toBe("/d/a.txt");
    expect(joinFtPath("/d", "../a")).toBeNull();
    expect(joinFtPath("/d", "x/y")).toBeNull();
    expect(joinFtPath("d", "a")).toBeNull();
  });

  it("splits a path", () => {
    expect(ftDirOf("/a/b/c.txt")).toBe("/a/b");
    expect(ftDirOf("/c.txt")).toBe("/");
    expect(ftDirOf("/")).toBe("/");
    expect(ftNameOf("/a/b/c.txt")).toBe("c.txt");
    expect(ftNameOf("/")).toBe("");
  });

  it("knows a single name", () => {
    expect(isFtName("a.txt")).toBe(true);
    expect(isFtName("a/b")).toBe(false);
    expect(isFtName("..")).toBe(false);
    expect(isFtName("")).toBe(false);
  });
});

describe("sanitizeFtFileName", () => {
  it("keeps ordinary names", () => {
    expect(sanitizeFtFileName("report 2026.pdf")).toBe("report 2026.pdf");
    expect(sanitizeFtFileName("截图.png")).toBe("截图.png");
  });

  it("turns separators and control characters into underscores", () => {
    expect(sanitizeFtFileName("a/b\\c\x00d\ne.txt")).toBe("a_b_c_d_e.txt");
    expect(sanitizeFtFileName('a:b*c?d"e<f>g|h.txt')).toBe("a_b_c_d_e_f_g_h.txt");
  });

  it("trims and refuses what is left empty or a dot name", () => {
    expect(sanitizeFtFileName("  a.txt  ")).toBe("a.txt");
    expect(sanitizeFtFileName("   ")).toBeNull();
    expect(sanitizeFtFileName("..")).toBeNull();
    expect(sanitizeFtFileName(".")).toBeNull();
  });

  it("shortens a long name but keeps its extension", () => {
    const out = sanitizeFtFileName(`${"n".repeat(400)}.tar.gz`);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(FT_NAME_MAX);
    expect(out!.endsWith(".gz")).toBe(true);
  });
});

describe("request schemas", () => {
  it("download needs a channel id and a normalised file path", () => {
    const ok = (v: unknown) => FtDownloadRequestSchema.safeParse(v).success;
    expect(ok({ cid: "5", path: "/a.txt" })).toBe(true);
    expect(ok({ cid: "5", path: "/a.txt", cpw: "pw" })).toBe(true);
    expect(ok({ cid: "5", path: "/" })).toBe(false);
    expect(ok({ cid: "5", path: "//a.txt" })).toBe(false);
    expect(ok({ cid: "5", path: "/../a" })).toBe(false);
    expect(ok({ cid: "x", path: "/a" })).toBe(false);
    expect(ok({ cid: "5", path: "/a", extra: 1 })).toBe(false);
  });

  it("upload query takes cid, path and an overwrite flag", () => {
    const parse = (v: unknown) => FtUploadQuerySchema.safeParse(v);
    expect(parse({ cid: "5", path: "/a.txt" }).data).toEqual({
      cid: "5",
      path: "/a.txt",
      overwrite: false,
    });
    expect(parse({ cid: "5", path: "/a.txt", overwrite: "1" }).data?.overwrite).toBe(true);
    expect(parse({ cid: "5", path: "/a.txt", overwrite: "yes" }).success).toBe(false);
    expect(parse({ cid: "5", path: "/" }).success).toBe(false);
  });
});

describe("formatBytes", () => {
  it("uses binary units with at most one decimal", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(100 * 1024 * 1024)).toBe("100 MB");
    expect(formatBytes(5.25 * 1024 ** 3)).toBe("5.3 GB");
  });
});

describe("ftMediaMimeOf", () => {
  it("names the video and audio types it serves inline, by extension", () => {
    expect(ftMediaMimeOf("clip.webm")).toBe("video/webm");
    expect(ftMediaMimeOf("CLIP.MP4")).toBe("video/mp4");
    expect(ftMediaMimeOf("a.m4v")).toBe("video/mp4");
    expect(ftMediaMimeOf("a.ogv")).toBe("video/ogg");
    expect(ftMediaMimeOf("song.mp3")).toBe("audio/mpeg");
    expect(ftMediaMimeOf("song.m4a")).toBe("audio/mp4");
    expect(ftMediaMimeOf("song.ogg")).toBe("audio/ogg");
    expect(ftMediaMimeOf("song.opus")).toBe("audio/ogg");
    expect(ftMediaMimeOf("song.flac")).toBe("audio/flac");
    expect(ftMediaMimeOf("song.wav")).toBe("audio/wav");
  });

  it("refuses everything else, above all what a browser would render as a page", () => {
    for (const name of [
      "a.html",
      "a.htm",
      "a.svg",
      "a.xml",
      "a.xhtml",
      "a.pdf",
      "a.js",
      "a.txt",
      "a.png",
      "a.mov",
      "a.mkv",
      "mp4",
      ".mp4",
      "a.mp4.html",
      "a.mp4 ",
      "",
    ]) {
      expect(ftMediaMimeOf(name), name).toBeNull();
    }
  });
});
