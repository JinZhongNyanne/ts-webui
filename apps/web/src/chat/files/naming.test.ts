import { describe, expect, it } from "vitest";
import { FT_NAME_MAX } from "@jinz/protocol";
import {
  imageMimeOf,
  pastedName,
  playableMimeOf,
  stampedName,
  uniqueName,
  videoMimeOf,
} from "./naming";

const at = new Date(2026, 8, 19, 7, 5, 3);

describe("uniqueName", () => {
  it("keeps a free name", () => {
    expect(uniqueName("a.txt", new Set(["b.txt"]))).toBe("a.txt");
  });

  it('adds " (2)", " (3)" in front of the extension like TS3 and file managers', () => {
    expect(uniqueName("a.txt", new Set(["a.txt"]))).toBe("a (2).txt");
    expect(uniqueName("a.txt", new Set(["a.txt", "a (2).txt"]))).toBe("a (3).txt");
  });

  it("ignores case, since a Windows server does", () => {
    expect(uniqueName("A.TXT", new Set(["a.txt"]))).toBe("A (2).TXT");
  });

  it("handles names without or with only an extension", () => {
    expect(uniqueName("README", new Set(["readme"]))).toBe("README (2)");
    expect(uniqueName(".env", new Set([".env"]))).toBe(".env (2)");
    expect(uniqueName("x.tar.gz", new Set(["x.tar.gz"]))).toBe("x.tar (2).gz");
  });

  it("stays within the longest name the server takes", () => {
    const long = `${"n".repeat(FT_NAME_MAX - 4)}.txt`;
    const next = uniqueName(long, new Set([long]));
    expect(next.length).toBeLessThanOrEqual(FT_NAME_MAX);
    expect(next).toMatch(/n \(2\)\.txt$/);
  });
});

describe("stampedName", () => {
  it("puts the local date and time in front of the extension", () => {
    expect(stampedName("photo.jpg", at)).toBe("photo_20260919-070503.jpg");
    expect(stampedName("notes", at)).toBe("notes_20260919-070503");
  });
});

describe("pastedName", () => {
  it("names a pasted image after its type and the time", () => {
    expect(pastedName("image/png", at)).toBe("image_20260919-070503.png");
    expect(pastedName("image/jpeg", at)).toBe("image_20260919-070503.jpg");
    expect(pastedName("application/x-thing", at)).toBe("file_20260919-070503.bin");
    expect(pastedName("", at)).toBe("file_20260919-070503.bin");
  });
});

describe("imageMimeOf", () => {
  it("knows the raster formats a browser shows", () => {
    expect(imageMimeOf("a.PNG")).toBe("image/png");
    expect(imageMimeOf("a.jpeg")).toBe("image/jpeg");
    expect(imageMimeOf("a.jpg")).toBe("image/jpeg");
    expect(imageMimeOf("a.gif")).toBe("image/gif");
    expect(imageMimeOf("a.webp")).toBe("image/webp");
  });

  it("leaves out SVG (a document, not a picture) and everything else", () => {
    expect(imageMimeOf("a.svg")).toBeNull();
    expect(imageMimeOf("a.html")).toBeNull();
    expect(imageMimeOf("png")).toBeNull();
  });
});

describe("videoMimeOf", () => {
  it("knows the containers a browser can actually play", () => {
    expect(videoMimeOf("clip.MP4")).toBe("video/mp4");
    expect(videoMimeOf("clip.m4v")).toBe("video/mp4");
    expect(videoMimeOf("clip.webm")).toBe("video/webm");
    expect(videoMimeOf("clip.ogv")).toBe("video/ogg");
  });

  it("refuses the containers no browser plays, so they stay plain downloads", () => {
    for (const name of ["clip.mkv", "clip.avi", "clip.wmv", "clip.flv", "clip.mov", "clip.ogg"]) {
      expect(videoMimeOf(name)).toBeNull();
    }
  });

  it("is not fooled by a name without an extension", () => {
    expect(videoMimeOf("mp4")).toBeNull();
    expect(videoMimeOf("")).toBeNull();
  });
});

describe("playableMimeOf", () => {
  it("answers for a picture as well as for a video", () => {
    expect(playableMimeOf("a.png")).toBe("image/png");
    expect(playableMimeOf("a.webm")).toBe("video/webm");
    expect(playableMimeOf("a.mkv")).toBeNull();
  });
});
