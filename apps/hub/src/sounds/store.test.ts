import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_SOUNDS } from "@jinz/protocol";
import { SoundStore } from "./store.js";

const WAV = Buffer.concat([
  Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"),
  Buffer.alloc(32),
]);

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-sounds-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("SoundStore", () => {
  it("stores a clip under a server-made id, with its file in the blobs directory", () => {
    const store = new SoundStore(dir);
    const result = store.add("Horn", WAV, "audio/wav", "alice", 1000);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.sound).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: "Horn",
      volume: 100,
      contentType: "audio/wav",
      bytes: WAV.length,
      addedBy: "alice",
      addedAt: 1000,
    });
    expect(readdirSync(dir).sort()).toEqual(["blobs", "sounds.json"]);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([`${result.sound.id}.wav`]);
    expect(store.read(result.sound.id)).toEqual({ body: WAV, contentType: "audio/wav" });
  });

  it("renames, re-levels and deletes, keeping everything else", () => {
    const store = new SoundStore(dir);
    const added = store.add("Horn", WAV, "audio/wav", "alice");
    if (!added.ok) throw new Error("add failed");
    const id = added.sound.id;
    expect(store.update(id, { name: "Big horn" })).toMatchObject({ name: "Big horn", volume: 100 });
    expect(store.update(id, { volume: 150 })).toMatchObject({ name: "Big horn", volume: 150 });
    expect(store.update("nope", { volume: 1 })).toBeNull();
    expect(store.remove(id)).toBe(true);
    expect(store.remove(id)).toBe(false);
    expect(store.list()).toEqual([]);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([]);
  });

  it("stops at the cap", () => {
    const store = new SoundStore(dir);
    for (let i = 0; i < MAX_SOUNDS; i++) store.add(`s${i}`, WAV, "audio/wav", "a");
    expect(store.add("one more", WAV, "audio/wav", "a")).toEqual({ ok: false, reason: "full" });
  });

  it("survives a restart and skips entries it cannot trust", () => {
    const store = new SoundStore(dir);
    const added = store.add("Horn", WAV, "audio/wav", "alice");
    if (!added.ok) throw new Error("add failed");
    const index = JSON.parse(readFileSync(path.join(dir, "sounds.json"), "utf8")) as object[];
    writeFileSync(
      path.join(dir, "sounds.json"),
      JSON.stringify([
        ...index,
        { ...index[0], id: "../../etc/passwd" },
        { ...index[0], id: "00000000-0000-0000-0000-000000000000", contentType: "text/html" },
        { ...index[0], id: "11111111-1111-1111-1111-111111111111", name: "" },
        { ...index[0], id: "22222222-2222-2222-2222-222222222222", volume: 999 },
      ]),
    );
    const again = new SoundStore(dir);
    expect(again.list().map((s) => [s.name, s.volume])).toEqual([
      ["Horn", 100],
      ["Horn", 200],
    ]);
  });

  it("starts over on a corrupt index", () => {
    writeFileSync(path.join(dir, "sounds.json"), "{nope");
    expect(new SoundStore(dir).list()).toEqual([]);
  });

  it("picks up the clips of a hub that kept them in the root directory", () => {
    // What every deployment before the blobs directory has on disk.
    const first = new SoundStore(dir);
    const added = first.add("Horn", WAV, "audio/wav", "alice");
    if (!added.ok) throw new Error("add failed");
    const id = added.sound.id;
    renameSync(path.join(dir, "blobs", `${id}.wav`), path.join(dir, `${id}.wav`));
    rmSync(path.join(dir, "blobs"), { recursive: true });

    const store = new SoundStore(dir);
    expect(store.read(id)).toEqual({ body: WAV, contentType: "audio/wav" });
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([`${id}.wav`]);
    expect(store.list().map((s) => s.name)).toEqual(["Horn"]);
    expect(store.remove(id)).toBe(true);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([]);
  });

  it("leaves the index and files it does not recognise where they are", () => {
    const first = new SoundStore(dir);
    const added = first.add("Horn", WAV, "audio/wav", "alice");
    if (!added.ok) throw new Error("add failed");
    renameSync(
      path.join(dir, "blobs", `${added.sound.id}.wav`),
      path.join(dir, `${added.sound.id}.wav`),
    );
    writeFileSync(path.join(dir, "notes.txt"), "mine");
    writeFileSync(path.join(dir, "sounds.json.tmp"), "[");
    writeFileSync(path.join(dir, "deadbeef.wav"), "not an id");

    new SoundStore(dir);
    expect(readdirSync(dir).sort()).toEqual([
      "blobs",
      "deadbeef.wav",
      "notes.txt",
      "sounds.json",
      "sounds.json.tmp",
    ]);
  });

  it("moves nothing more when it opens the same directory twice", () => {
    const first = new SoundStore(dir);
    const added = first.add("Horn", WAV, "audio/wav", "alice");
    if (!added.ok) throw new Error("add failed");
    renameSync(
      path.join(dir, "blobs", `${added.sound.id}.wav`),
      path.join(dir, `${added.sound.id}.wav`),
    );
    new SoundStore(dir);
    const after = readdirSync(path.join(dir, "blobs"));
    new SoundStore(dir);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual(after);
    expect(new SoundStore(dir).read(added.sound.id)).toEqual({
      body: WAV,
      contentType: "audio/wav",
    });
  });

  it("writes the index atomically", () => {
    const store = new SoundStore(dir);
    store.add("Horn", WAV, "audio/wav", "alice");
    expect(readdirSync(dir).some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});

describe("SoundStore: an index it could not read", () => {
  it("leaves an unparseable index alone instead of writing an empty one over it", () => {
    const first = new SoundStore(dir);
    first.add("Horn", WAV, "audio/wav", "alice");
    writeFileSync(path.join(dir, "sounds.json"), "[{ half");

    const store = new SoundStore(dir);
    expect(() => store.add("Bell", WAV, "audio/wav", "bob")).not.toThrow();
    expect(readFileSync(path.join(dir, "sounds.json"), "utf8")).toBe("[{ half");
  });
});
