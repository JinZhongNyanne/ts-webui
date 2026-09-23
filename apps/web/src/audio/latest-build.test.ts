import { describe, expect, it } from "vitest";
import { createLatestBuilds } from "./latest-build";

/** A stand-in encoder that remembers being closed. */
function product(name: string): { name: string; closed: boolean; close(): void } {
  return {
    name,
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

/** A build the test finishes by hand, so two can overlap in either order. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLatestBuilds", () => {
  it("hands over the result of a build nothing overtook", async () => {
    const builds = createLatestBuilds();
    const made = product("only");
    await expect(builds.run(() => Promise.resolve(made))).resolves.toBe(made);
    expect(made.closed).toBe(false);
  });

  it("closes and discards an overtaken build that finishes first (codec, then quality)", async () => {
    const builds = createLatestBuilds();
    const first = deferred<ReturnType<typeof product>>();
    const second = deferred<ReturnType<typeof product>>();
    const a = builds.run(() => first.promise);
    const b = builds.run(() => second.promise);
    const oldEncoder = product("codec");
    const newEncoder = product("quality");
    first.resolve(oldEncoder);
    await expect(a).resolves.toBeNull();
    expect(oldEncoder.closed).toBe(true);
    second.resolve(newEncoder);
    await expect(b).resolves.toBe(newEncoder);
    expect(newEncoder.closed).toBe(false);
  });

  it("closes and discards an overtaken build that finishes last", async () => {
    const builds = createLatestBuilds();
    const first = deferred<ReturnType<typeof product>>();
    const second = deferred<ReturnType<typeof product>>();
    const a = builds.run(() => first.promise);
    const b = builds.run(() => second.promise);
    const newEncoder = product("new");
    second.resolve(newEncoder);
    await expect(b).resolves.toBe(newEncoder);
    const oldEncoder = product("old");
    first.resolve(oldEncoder);
    await expect(a).resolves.toBeNull();
    expect(oldEncoder.closed).toBe(true);
    expect(newEncoder.closed).toBe(false);
  });

  it("closes what a build made after it was superseded (the send path went away)", async () => {
    const builds = createLatestBuilds();
    const pending = deferred<ReturnType<typeof product>>();
    const run = builds.run(() => pending.promise);
    builds.supersede();
    const made = product("late");
    pending.resolve(made);
    await expect(run).resolves.toBeNull();
    expect(made.closed).toBe(true);
  });

  it("passes on the failure of the current build", async () => {
    const builds = createLatestBuilds();
    await expect(builds.run(() => Promise.reject(new Error("no encoder")))).rejects.toThrow(
      "no encoder",
    );
  });

  it("ignores the failure of a build already overtaken", async () => {
    const builds = createLatestBuilds();
    const first = deferred<ReturnType<typeof product>>();
    const a = builds.run(() => first.promise);
    const b = builds.run(() => Promise.resolve(product("new")));
    first.reject(new Error("old one failed"));
    await expect(a).resolves.toBeNull();
    await expect(b).resolves.toMatchObject({ name: "new" });
  });
});
