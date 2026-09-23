import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  clampView,
  initialView,
  outputSize,
  panView,
  sourceRect,
  zoomView,
  type CropView,
} from "./crop";

const view = (over: Partial<CropView> = {}): CropView => ({
  imgW: 400,
  imgH: 200,
  box: 100,
  scale: 0.5,
  x: -50,
  y: 0,
  ...over,
});

describe("crop view", () => {
  it("starts centred, the short side filling the box", () => {
    expect(initialView(400, 200, 100)).toEqual(view());
    const tall = initialView(300, 600, 150);
    expect(tall.scale).toBe(0.5);
    expect(tall.x).toBe(0);
    expect(tall.y).toBe(-75);
  });

  it("never leaves an empty edge in the box", () => {
    expect(clampView(view({ x: 20, y: 5 }))).toMatchObject({ x: 0, y: 0 });
    expect(clampView(view({ x: -500, y: -500 }))).toMatchObject({ x: -100, y: 0 });
    // Too small to cover: scaled back up to cover.
    expect(clampView(view({ scale: 0.1 })).scale).toBe(0.5);
  });

  it("pans by a drag, within the image", () => {
    expect(panView(view(), -30, 0)).toMatchObject({ x: -80, y: 0 });
    expect(panView(view(), -300, 40)).toMatchObject({ x: -100, y: 0 });
  });

  it("zooms around a point, keeping that point under the cursor", () => {
    const v = zoomView(view(), 2, 50, 50);
    expect(v.scale).toBe(1);
    // The image point under (50,50) was (200,100); it still is.
    expect((50 - v.x) / v.scale).toBeCloseTo(200);
    expect((50 - v.y) / v.scale).toBeCloseTo(100);
  });

  it("keeps the zoom between cover and MAX_ZOOM times that", () => {
    expect(zoomView(view(), 0.1, 50, 50).scale).toBe(0.5);
    expect(zoomView(view(), 1000, 50, 50).scale).toBe(0.5 * MAX_ZOOM);
  });

  it("maps the box to a square of source pixels", () => {
    expect(sourceRect(view())).toEqual({ sx: 100, sy: 0, size: 200 });
    expect(sourceRect(zoomView(view(), 2, 0, 0))).toEqual({ sx: 100, sy: 0, size: 100 });
  });

  it("outputs at most the avatar size, never upscaling", () => {
    expect(outputSize(200, 300)).toBe(200);
    expect(outputSize(1200, 300)).toBe(300);
    expect(outputSize(0.4, 300)).toBe(1);
  });
});
