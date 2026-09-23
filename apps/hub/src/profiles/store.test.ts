import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ProfileStore } from "./store.js";

function newStore(): { store: ProfileStore; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "jinz-profiles-"));
  return { store: new ProfileStore(dir), dir };
}

describe("ProfileStore", () => {
  it("saves, reads and bumps the revision of an asset", () => {
    const { store } = newStore();
    const first = store.save("uid/with+slash=", "icon", Buffer.from("a"), "image/png");
    expect(first).toEqual({ uid: "uid/with+slash=", icon: 1, sound: null });

    const second = store.save("uid/with+slash=", "icon", Buffer.from("bb"), "image/png");
    expect(second.icon).toBe(2);
    expect(store.read("uid/with+slash=", "icon")).toEqual({
      body: Buffer.from("bb"),
      contentType: "image/png",
    });
  });

  it("keeps icon and sound independent and forgets a user with neither", () => {
    const { store } = newStore();
    store.save("u", "icon", Buffer.from("i"), "image/png");
    store.save("u", "sound", Buffer.from("s"), "audio/mpeg");
    expect(store.get("u")).toEqual({ uid: "u", icon: 1, sound: 1 });

    store.remove("u", "icon");
    expect(store.get("u")).toEqual({ uid: "u", icon: null, sound: 1 });
    expect(store.read("u", "icon")).toBeNull();

    store.remove("u", "sound");
    expect(store.list()).toEqual([]);
  });

  it("reloads what a previous run wrote", () => {
    const { store, dir } = newStore();
    store.save("u", "sound", Buffer.from("s"), "audio/ogg");
    const reopened = new ProfileStore(dir);
    expect(reopened.get("u")).toEqual({ uid: "u", icon: null, sound: 1 });
    expect(reopened.read("u", "sound")?.contentType).toBe("audio/ogg");
  });

  it("keeps the uploads in a blobs directory, not beside the index", () => {
    const { store, dir } = newStore();
    store.save("u", "icon", Buffer.from("i"), "image/png");
    expect(readdirSync(dir).sort()).toEqual(["blobs", "index.json"]);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([
      expect.stringMatching(/^[0-9a-f]{32}\.icon\.png$/),
    ]);
  });

  it("sweeps blobs the index does not know about, and only those", () => {
    const { store, dir } = newStore();
    store.save("u", "icon", Buffer.from("i"), "image/png");
    const kept = readdirSync(path.join(dir, "blobs"));
    writeFileSync(path.join(dir, "blobs", `${"a".repeat(32)}.icon.png`), "x");
    writeFileSync(path.join(dir, "notes.txt"), "mine");
    store.sweep();
    expect(readdirSync(path.join(dir, "blobs"))).toEqual(kept);
    expect(readdirSync(dir).sort()).toEqual(["blobs", "index.json", "notes.txt"]);
  });

  it("picks up the files of a hub that kept them beside the index", () => {
    const { store, dir } = newStore();
    store.save("u", "icon", Buffer.from("i"), "image/png");
    store.save("u", "sound", Buffer.from("s"), "audio/ogg");
    // Put it back the way every deployment before the blobs directory had it.
    const moved = readdirSync(path.join(dir, "blobs"));
    for (const name of moved) renameSync(path.join(dir, "blobs", name), path.join(dir, name));
    rmSync(path.join(dir, "blobs"), { recursive: true });
    writeFileSync(path.join(dir, "notes.txt"), "mine");

    const reopened = new ProfileStore(dir);
    expect(readdirSync(path.join(dir, "blobs")).sort()).toEqual([...moved].sort());
    expect(readdirSync(dir).sort()).toEqual(["blobs", "index.json", "notes.txt"]);
    expect(reopened.read("u", "icon")).toEqual({
      body: Buffer.from("i"),
      contentType: "image/png",
    });
    expect(reopened.read("u", "sound")?.contentType).toBe("audio/ogg");
    reopened.sweep();
    expect(readdirSync(path.join(dir, "blobs")).sort()).toEqual([...moved].sort());

    reopened.remove("u", "icon");
    expect(readdirSync(path.join(dir, "blobs")).length).toBe(1);
    expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("mine");
  });

  it("moves nothing more when it opens the same directory again", () => {
    const { store, dir } = newStore();
    store.save("u", "icon", Buffer.from("i"), "image/png");
    const name = readdirSync(path.join(dir, "blobs"))[0] ?? "";
    renameSync(path.join(dir, "blobs", name), path.join(dir, name));
    new ProfileStore(dir);
    const after = readdirSync(path.join(dir, "blobs"));
    new ProfileStore(dir);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual(after);
    expect(new ProfileStore(dir).read("u", "icon")?.body).toEqual(Buffer.from("i"));
  });
});

describe("ProfileStore: an index it could not read", () => {
  /** Two uploads on disk, and the index replaced by whatever `breakIndex` puts there. */
  function brokenStore(breakIndex: (indexFile: string) => void): { dir: string; blobs: string[] } {
    const { store, dir } = newStore();
    store.save("u", "icon", Buffer.from("i"), "image/png");
    store.save("u", "sound", Buffer.from("s"), "audio/ogg");
    const blobs = readdirSync(path.join(dir, "blobs")).sort();
    breakIndex(path.join(dir, "index.json"));
    return { dir, blobs };
  }

  // A directory where the index file goes: readFileSync fails with EISDIR, which
  // stands in for the EIO, EACCES or EBUSY a real disk hands us.
  const asDirectory = (indexFile: string) => {
    rmSync(indexFile);
    mkdirSync(indexFile);
  };

  it("sweeps nothing when the index file cannot be read", () => {
    const { dir, blobs } = brokenStore(asDirectory);
    const store = new ProfileStore(dir);
    store.sweep();
    expect(readdirSync(path.join(dir, "blobs")).sort()).toEqual(blobs);
  });

  it("sweeps nothing when the index file cannot be parsed", () => {
    const { dir, blobs } = brokenStore((indexFile) => writeFileSync(indexFile, "[{ half"));
    const store = new ProfileStore(dir);
    store.sweep();
    expect(readdirSync(path.join(dir, "blobs")).sort()).toEqual(blobs);
  });

  it("leaves the unreadable index alone instead of writing an empty one over it", () => {
    const { dir } = brokenStore((indexFile) => writeFileSync(indexFile, "[{ half"));
    const store = new ProfileStore(dir);
    expect(() => store.save("other", "icon", Buffer.from("x"), "image/png")).not.toThrow();
    expect(readFileSync(path.join(dir, "index.json"), "utf8")).toBe("[{ half");
  });

  it("still sweeps on a genuine first run, when there is no index at all", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "jinz-profiles-"));
    const store = new ProfileStore(dir);
    writeFileSync(path.join(dir, "blobs", `${"a".repeat(32)}.icon.png`), "x");
    store.sweep();
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([]);
  });
});
