import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MusicStateStore } from "./music-state.js";

const dirs: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "music-state-"));
  dirs.push(dir);
  return path.join(dir, "music-state.json");
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("MusicStateStore", () => {
  // The bug this exists for: a hub restart forgot that FM was playing, so the
  // panel lost its FM badge and the play mode came unlocked.
  it("remembers a radio, its owner and the requesters across a restart", () => {
    const file = tempFile();
    const first = new MusicStateStore(file);
    const s = first.forUrl("http://bot:3000");
    s.radios.set("b1", "fm");
    s.radioOwners.set("b1", "Alice");
    s.requesters.record("b1", [{ id: "1", name: "x", platform: "qq" }], "Alice");
    first.changed();
    first.flush();

    const again = new MusicStateStore(file).forUrl("http://bot:3000");
    expect(again.radios.get("b1")).toBe("fm");
    expect(again.radioOwners.get("b1")).toBe("Alice");
    expect(again.requesters.nameFor("b1", { id: "1", platform: "qq" })).toBe("Alice");
  });

  it("starts empty on a missing or broken file, and drops unknown radios", () => {
    const file = tempFile();
    expect(new MusicStateStore(file).forUrl("u").radios.size).toBe(0);
    writeFileSync(file, "{not json");
    expect(new MusicStateStore(file).forUrl("u").radios.size).toBe(0);
    writeFileSync(file, JSON.stringify({ bots: { u: { radios: { b1: "shuffle", b2: "fm" } } } }));
    expect([...new MusicStateStore(file).forUrl("u").radios]).toEqual([["b2", "fm"]]);
  });

  it("writes nothing without a file", () => {
    const store = new MusicStateStore();
    store.forUrl("u").radios.set("b1", "fm");
    store.changed();
    store.flush();
    expect(store.forUrl("u").radios.get("b1")).toBe("fm");
  });

  it("forgets a URL only when it holds nothing", () => {
    const file = tempFile();
    const store = new MusicStateStore(file);
    store.forUrl("empty");
    store.forUrl("busy").radios.set("b1", "recommend");
    store.forgetIfEmpty("empty");
    store.forgetIfEmpty("busy");
    store.flush();
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).bots)).toEqual(["busy"]);
  });
});
