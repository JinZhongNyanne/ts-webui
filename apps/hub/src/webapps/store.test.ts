import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppStore } from "./store.js";

const PNG = Buffer.from("\x89PNG\r\n\x1a\n", "latin1");

let dir: string;
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "jinz-apps-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function added(store: AppStore): string {
  const result = store.add("Docs", "https://docs.example/", "alice", 1000);
  if (!result.ok) throw new Error("add failed");
  return result.app.id;
}

describe("AppStore", () => {
  it("keeps an icon in the blobs directory, not beside the index", () => {
    const store = new AppStore(dir);
    const id = added(store);
    expect(store.setIcon(id, PNG, "image/png")).toMatchObject({ iconRev: 1 });
    expect(readdirSync(dir).sort()).toEqual(["apps.json", "blobs"]);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([`${id}.png`]);
    expect(store.readIcon(id)).toEqual({ body: PNG, contentType: "image/png" });
  });

  it("deletes the icon file with the site", () => {
    const store = new AppStore(dir);
    const id = added(store);
    store.setIcon(id, PNG, "image/png");
    expect(store.remove(id)).toBe(true);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([]);
    expect(store.readIcon(id)).toBeNull();
  });

  it("picks up the icons of a hub that kept them beside the index", () => {
    const first = new AppStore(dir);
    const id = added(first);
    first.setIcon(id, PNG, "image/png");
    // Put it back the way every deployment before the blobs directory had it.
    renameSync(path.join(dir, "blobs", `${id}.png`), path.join(dir, `${id}.png`));
    rmSync(path.join(dir, "blobs"), { recursive: true });
    writeFileSync(path.join(dir, "notes.txt"), "mine");

    const store = new AppStore(dir);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([`${id}.png`]);
    expect(store.readIcon(id)).toEqual({ body: PNG, contentType: "image/png" });
    expect(readFileSync(path.join(dir, "notes.txt"), "utf8")).toBe("mine");
    expect(readdirSync(dir).sort()).toEqual(["apps.json", "blobs", "notes.txt"]);
    expect(store.remove(id)).toBe(true);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual([]);
  });

  it("moves nothing more when it opens the same directory again", () => {
    const first = new AppStore(dir);
    const id = added(first);
    first.setIcon(id, PNG, "image/png");
    renameSync(path.join(dir, "blobs", `${id}.png`), path.join(dir, `${id}.png`));
    new AppStore(dir);
    const after = readdirSync(path.join(dir, "blobs"));
    new AppStore(dir);
    expect(readdirSync(path.join(dir, "blobs"))).toEqual(after);
    expect(new AppStore(dir).readIcon(id)?.body).toEqual(PNG);
  });
});

describe("AppStore: an index it could not read", () => {
  it("leaves an unparseable index alone instead of writing an empty one over it", () => {
    const first = new AppStore(dir);
    added(first);
    writeFileSync(path.join(dir, "apps.json"), "[{ half");

    const store = new AppStore(dir);
    expect(() => store.add("Wiki", "https://wiki.example/", "bob", 2000)).not.toThrow();
    expect(readFileSync(path.join(dir, "apps.json"), "utf8")).toBe("[{ half");
  });
});
