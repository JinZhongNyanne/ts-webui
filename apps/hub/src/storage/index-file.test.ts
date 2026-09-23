import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readIndexFile } from "./index-file.js";

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-index-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("readIndexFile", () => {
  it("reports a file nobody has written yet as empty, not as a failure", () => {
    expect(readIndexFile(path.join(dir, "index.json"))).toEqual({ state: "empty" });
  });

  it("hands back the bytes of an index it could read", () => {
    const file = path.join(dir, "index.json");
    writeFileSync(file, "[]");
    expect(readIndexFile(file)).toEqual({ state: "loaded", raw: "[]" });
  });

  it("keeps a read that failed for any other reason apart from a missing file", () => {
    // A directory in the index's place fails with EISDIR, standing in for the
    // EIO, EACCES or EBUSY a real disk hands us; either way the index is there.
    const file = path.join(dir, "index.json");
    mkdirSync(file);
    const read = readIndexFile(file);
    expect(read.state).toBe("unreadable");
    expect(read).toHaveProperty("err");
  });
});
