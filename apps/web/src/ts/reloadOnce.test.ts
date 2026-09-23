import { describe, expect, it } from "vitest";
import { RELOAD_KEY, RELOAD_WINDOW_MS, reloadOnce } from "./reloadOnce";

function memory() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  };
}

describe("reloadOnce", () => {
  it("reloads once, then refuses until the window has passed", () => {
    const storage = memory();
    let reloads = 0;
    let now = 1_000_000;
    const deps = { storage, reload: () => reloads++, now: () => now };
    expect(reloadOnce(deps)).toBe(true);
    expect(storage.map.get(RELOAD_KEY)).toBe(String(now));
    now += 5_000;
    expect(reloadOnce(deps)).toBe(false);
    now += RELOAD_WINDOW_MS;
    expect(reloadOnce(deps)).toBe(true);
    expect(reloads).toBe(2);
  });

  it("does not reload when storage is unusable", () => {
    let reloads = 0;
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => undefined,
    };
    expect(reloadOnce({ storage, reload: () => reloads++, now: () => 1 })).toBe(false);
    expect(reloads).toBe(0);
  });
});
