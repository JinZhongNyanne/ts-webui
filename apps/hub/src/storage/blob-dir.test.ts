import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BLOBS_DIR, openBlobDir } from "./blob-dir.js";

const isBlob = (name: string): boolean => name.endsWith(".bin");

function newDir(): string {
  return mkdtempSync(path.join(tmpdir(), "jinz-blob-dir-"));
}

describe("openBlobDir", () => {
  it("creates the blobs directory and returns its path", () => {
    const dir = newDir();
    const blobs = openBlobDir(dir, isBlob);
    expect(blobs).toBe(path.join(dir, BLOBS_DIR));
    expect(existsSync(blobs)).toBe(true);
  });

  it("moves blobs left in the root by an older version into the subdirectory", () => {
    const dir = newDir();
    writeFileSync(path.join(dir, "one.bin"), "1");
    writeFileSync(path.join(dir, "two.bin"), "2");
    const blobs = openBlobDir(dir, isBlob);
    expect(readdirSync(dir).sort()).toEqual([BLOBS_DIR]);
    expect(readdirSync(blobs).sort()).toEqual(["one.bin", "two.bin"]);
    expect(readFileSync(path.join(blobs, "two.bin"), "utf8")).toBe("2");
  });

  it("leaves the index, its temporary file and anything unrecognised alone", () => {
    const dir = newDir();
    writeFileSync(path.join(dir, "index.json"), "[]");
    writeFileSync(path.join(dir, "index.json.tmp"), "[");
    writeFileSync(path.join(dir, "notes.txt"), "mine");
    mkdirSync(path.join(dir, "somedir"));
    openBlobDir(dir, isBlob);
    expect(readdirSync(dir).sort()).toEqual([
      BLOBS_DIR,
      "index.json",
      "index.json.tmp",
      "notes.txt",
      "somedir",
    ]);
  });

  it("changes nothing when run again", () => {
    const dir = newDir();
    writeFileSync(path.join(dir, "one.bin"), "1");
    openBlobDir(dir, isBlob);
    openBlobDir(dir, isBlob);
    openBlobDir(dir, isBlob);
    expect(readdirSync(dir).sort()).toEqual([BLOBS_DIR]);
    expect(readdirSync(path.join(dir, BLOBS_DIR))).toEqual(["one.bin"]);
    expect(readFileSync(path.join(dir, BLOBS_DIR, "one.bin"), "utf8")).toBe("1");
  });

  it("never overwrites or deletes a blob the subdirectory already holds", () => {
    const dir = newDir();
    mkdirSync(path.join(dir, BLOBS_DIR));
    writeFileSync(path.join(dir, "one.bin"), "old");
    writeFileSync(path.join(dir, BLOBS_DIR, "one.bin"), "new");
    openBlobDir(dir, isBlob);
    expect(readFileSync(path.join(dir, BLOBS_DIR, "one.bin"), "utf8")).toBe("new");
    expect(readFileSync(path.join(dir, "one.bin"), "utf8")).toBe("old");
  });
});
