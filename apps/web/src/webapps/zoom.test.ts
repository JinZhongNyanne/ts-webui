import { describe, expect, it } from "vitest";
import { MAX_ZOOM, MIN_ZOOM, clampZoom, parseZooms, stepZoom } from "./zoom";

describe("stepZoom", () => {
  it("walks the browser-like steps", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.9, -1)).toBe(0.8);
  });
  it("snaps an in-between value to the next step", () => {
    expect(stepZoom(1.05, 1)).toBe(1.1);
    expect(stepZoom(1.05, -1)).toBe(1);
  });
  it("stops at the ends", () => {
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });
});

describe("clampZoom", () => {
  it("keeps zoom in range", () => {
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("parseZooms", () => {
  it("keeps valid zooms, clamps wild ones and drops the rest", () =>
    expect(parseZooms({ a: 1.5, b: 40, c: "2", d: 1, e: Number.NaN })).toEqual({
      a: 1.5,
      b: MAX_ZOOM,
    }));
  it("survives junk", () => {
    expect(parseZooms(null)).toEqual({});
    expect(parseZooms([1, 2])).toEqual({});
  });
});
