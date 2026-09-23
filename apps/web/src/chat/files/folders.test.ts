import { describe, expect, it } from "vitest";
import {
  CHAT_IMAGE_DIR,
  CHAT_OTHER_DIR,
  EMPTY_FOLDERS,
  chatFolderFor,
  folderOutcome,
  forgetChannelFolders,
  recallFolder,
  rememberFolder,
} from "./folders";

describe("chatFolderFor", () => {
  it("puts the previewable pictures in /imgs", () => {
    for (const name of ["cat.png", "cat.JPG", "a.jpeg", "b.gif", "c.webp", "d.bmp", "e.avif"]) {
      expect(chatFolderFor(name)).toBe(CHAT_IMAGE_DIR);
    }
  });

  it("puts everything else in /files", () => {
    for (const name of ["notes.txt", "clip.mp4", "archive.zip", "noextension", "a.png.zip"]) {
      expect(chatFolderFor(name)).toBe(CHAT_OTHER_DIR);
    }
  });

  it("treats SVG as a document, not a picture", () =>
    expect(chatFolderFor("logo.svg")).toBe(CHAT_OTHER_DIR));

  it("sends a sticker's hash-named file to /imgs", () =>
    expect(chatFolderFor("sticker_aaaaaaaaaaaa.png")).toBe(CHAT_IMAGE_DIR));
});

describe("folderOutcome", () => {
  it("counts a successful create as ready", () => expect(folderOutcome(undefined)).toBe("ready"));

  it("counts the server's 'already exists' as ready", () =>
    expect(folderOutcome({ code: "2050" })).toBe("ready"));

  it("gives up on a refused create", () => {
    expect(folderOutcome({ code: "2568" })).toBe("unavailable");
    expect(folderOutcome({})).toBe("unavailable");
  });
});

describe("the folder memo", () => {
  it("answers nothing before anything was tried", () =>
    expect(recallFolder(EMPTY_FOLDERS, "5", CHAT_IMAGE_DIR)).toBeUndefined());

  it("remembers per channel and per folder, without touching the old map", () => {
    const one = rememberFolder(EMPTY_FOLDERS, "5", CHAT_IMAGE_DIR, "ready");
    const two = rememberFolder(one, "5", CHAT_OTHER_DIR, "unavailable");
    expect(recallFolder(two, "5", CHAT_IMAGE_DIR)).toBe("ready");
    expect(recallFolder(two, "5", CHAT_OTHER_DIR)).toBe("unavailable");
    expect(recallFolder(two, "6", CHAT_IMAGE_DIR)).toBeUndefined();
    expect(EMPTY_FOLDERS.size).toBe(0);
    expect(one.size).toBe(1);
  });

  it("forgets one channel and leaves the others", () => {
    const memo = rememberFolder(
      rememberFolder(EMPTY_FOLDERS, "5", CHAT_IMAGE_DIR, "ready"),
      "6",
      CHAT_IMAGE_DIR,
      "ready",
    );
    const after = forgetChannelFolders(memo, "5");
    expect(recallFolder(after, "5", CHAT_IMAGE_DIR)).toBeUndefined();
    expect(recallFolder(after, "6", CHAT_IMAGE_DIR)).toBe("ready");
    expect(memo.size).toBe(2);
  });

  it("does not confuse channels whose ids share a prefix", () => {
    const memo = rememberFolder(
      rememberFolder(EMPTY_FOLDERS, "5", CHAT_IMAGE_DIR, "ready"),
      "50",
      CHAT_IMAGE_DIR,
      "ready",
    );
    expect(recallFolder(forgetChannelFolders(memo, "5"), "50", CHAT_IMAGE_DIR)).toBe("ready");
  });
});
