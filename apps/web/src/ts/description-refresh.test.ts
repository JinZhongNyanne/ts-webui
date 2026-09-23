import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DESCRIPTION_REFRESH_MS, DescriptionRefresh } from "./description-refresh";

let shown = new Set<string>();
let asked: string[] = [];
let refresh: DescriptionRefresh;

beforeEach(() => {
  vi.useFakeTimers();
  shown = new Set(["5"]);
  asked = [];
  refresh = new DescriptionRefresh({
    isShown: (id) => shown.has(id),
    request: (id) => asked.push(id),
  });
});

afterEach(() => {
  refresh.cancelAll();
  vi.useRealTimers();
});

describe("DescriptionRefresh", () => {
  it("asks again for a description on screen, once a burst of edits has settled", () => {
    refresh.changed("5");
    vi.advanceTimersByTime(DESCRIPTION_REFRESH_MS / 2);
    refresh.changed("5");
    refresh.changed("5");
    vi.advanceTimersByTime(DESCRIPTION_REFRESH_MS - 1);
    expect(asked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(asked).toEqual(["5"]);
  });

  it("leaves descriptions nobody is looking at alone", () => {
    refresh.changed("6");
    vi.advanceTimersByTime(DESCRIPTION_REFRESH_MS);
    expect(asked).toEqual([]);
  });

  it("decides when the wait is over: closing the panel meanwhile means no fetch", () => {
    refresh.changed("5");
    shown = new Set();
    vi.advanceTimersByTime(DESCRIPTION_REFRESH_MS);
    expect(asked).toEqual([]);
  });

  it("cancels everything pending (a disconnect)", () => {
    refresh.changed("5");
    refresh.cancelAll();
    vi.advanceTimersByTime(DESCRIPTION_REFRESH_MS);
    expect(asked).toEqual([]);
  });
});
