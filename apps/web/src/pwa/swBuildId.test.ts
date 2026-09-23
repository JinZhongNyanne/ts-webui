import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildIdOf, stampServiceWorker, SW_BUILD_ID_PLACEHOLDER } from "./swBuildId";

const source = readFileSync(fileURLToPath(new URL("../../public/sw.js", import.meta.url)), "utf8");

/** The digest vite.config.ts uses. */
const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

describe("buildIdOf", () => {
  it("is the same for the same files in any order, so an unchanged build keeps its cache", () => {
    const a = buildIdOf(["assets/index-abc.js", "index.html", "assets/app-def.css"], sha256);
    const b = buildIdOf(["index.html", "assets/app-def.css", "assets/index-abc.js"], sha256);
    expect(a).toBe(b);
  });

  it("changes when any hashed file name does, which is when any asset's content does", () => {
    const before = buildIdOf(["assets/index-abc.js"], sha256);
    const after = buildIdOf(["assets/index-abd.js"], sha256);
    expect(before).not.toBe(after);
  });

  it("is short, and safe to put in a cache name and a string literal", () => {
    const id = buildIdOf(["assets/index-abc.js"], () => "0123456789abcdef0123456789abcdef");
    expect(id).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("stampServiceWorker", () => {
  it("writes the build id into the worker in place of the placeholder", () => {
    const stamped = stampServiceWorker(source, "0123456789ab");
    expect(stamped).not.toContain(SW_BUILD_ID_PLACEHOLDER);
    expect(stamped).toContain('"0123456789ab"');
    expect(stamped.length).toBe(
      source.length - SW_BUILD_ID_PLACEHOLDER.length + '"0123456789ab"'.length,
    );
  });

  it("finds exactly one placeholder in the real worker", () => {
    expect(source.split(SW_BUILD_ID_PLACEHOLDER)).toHaveLength(2);
  });

  it("fails the build when the placeholder has gone, rather than shipping a worker that never evicts", () => {
    expect(() => stampServiceWorker("const BUILD_ID = 'v1';", "0123456789ab")).toThrow(
      /placeholder/,
    );
  });

  it("refuses an id that could break out of the string it is written into", () => {
    expect(() => stampServiceWorker(source, 'x"; evil();"')).toThrow(/build id/);
    expect(() => stampServiceWorker(source, "")).toThrow(/build id/);
  });
});
