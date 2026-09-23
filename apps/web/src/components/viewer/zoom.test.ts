import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  WHEEL_ZOOM_STEP,
  ZOOM_STEP,
  actualView,
  canPan,
  fitScale,
  fitView,
  isActual,
  isFit,
  panView,
  pinchFactor,
  toggleFitActual,
  viewOf,
  zoomAtCentre,
  zoomPercent,
  zoomView,
  type PictureView,
} from "./zoom";

/** A 400×200 picture in a 200×200 viewport: fit is 0.5, actual is 1. */
const view = (over: Partial<PictureView> = {}): PictureView => ({
  ...viewOf(400, 200, 200, 200),
  ...over,
});

describe("fitScale", () => {
  it("fits the whole picture inside the viewport", () => {
    expect(fitScale({ imgW: 400, imgH: 200, viewW: 200, viewH: 200 })).toBe(0.5);
    expect(fitScale({ imgW: 200, imgH: 400, viewW: 200, viewH: 200 })).toBe(0.5);
  });

  it("never blows a small picture up to fill the window", () => {
    expect(fitScale({ imgW: 50, imgH: 50, viewW: 200, viewH: 200 })).toBe(1);
  });

  it("answers the smallest zoom for a picture with no size yet", () => {
    expect(fitScale({ imgW: 0, imgH: 0, viewW: 200, viewH: 200 })).toBe(MIN_ZOOM);
  });
});

describe("fitView", () => {
  it("starts fitted and centred", () => {
    const v = fitView(400, 200, 200, 200);
    expect(v.scale).toBe(0.5);
    expect(v.x).toBe(0);
    expect(v.y).toBe(50);
    expect(isFit(v)).toBe(true);
    expect(isActual(v)).toBe(false);
  });
});

describe("actualView", () => {
  it("goes to 100% around the middle of the viewport", () => {
    const v = actualView(view());
    expect(v.scale).toBe(1);
    expect(isActual(v)).toBe(true);
    // The picture point that was in the middle is still in the middle.
    expect(v.x).toBe(-100);
    expect(v.y).toBe(0);
  });
});

describe("zoomView", () => {
  it("keeps the picture point under the cursor where it was", () => {
    const zoomed = zoomView(view(), 2, 0, 100);
    expect(zoomed.scale).toBe(1);
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBe(0);
  });

  it("clamps to the named limits", () => {
    expect(zoomView(view(), 1000, 100, 100).scale).toBe(MAX_ZOOM);
    expect(zoomView(view(), 0.0001, 100, 100).scale).toBe(MIN_ZOOM);
  });

  it("zooms by the step from the centre of the viewport", () => {
    expect(zoomAtCentre(view(), ZOOM_STEP).scale).toBeCloseTo(0.5 * ZOOM_STEP);
    expect(zoomAtCentre(view(), 1 / ZOOM_STEP).scale).toBeCloseTo(0.5 / ZOOM_STEP);
  });

  it("centres a picture smaller than the viewport on both axes", () => {
    const small = zoomView(view(), 0.5, 0, 0);
    expect(small.x).toBe((200 - 400 * small.scale) / 2);
    expect(small.y).toBe((200 - 200 * small.scale) / 2);
  });
});

describe("panView", () => {
  it("does not pan an axis the picture already fits on", () => {
    const v = view();
    expect(panView(v, 40, 40)).toEqual(v);
    expect(canPan(v)).toBe(false);
  });

  it("pans within the picture once it is larger than the viewport", () => {
    const big = actualView(view());
    expect(canPan(big)).toBe(true);
    expect(panView(big, 40, 0)).toMatchObject({ x: -60, y: 0 });
    // Never dragged past its own edges.
    expect(panView(big, 10_000, 0).x).toBe(0);
    expect(panView(big, -10_000, 0).x).toBe(200 - 400);
  });
});

describe("toggleFitActual", () => {
  it("swaps between fitted and 100%", () => {
    const fitted = view();
    const actual = toggleFitActual(fitted);
    expect(isActual(actual)).toBe(true);
    expect(isFit(toggleFitActual(actual))).toBe(true);
  });

  it("goes back to fitted from any other zoom", () => {
    expect(isFit(toggleFitActual(zoomAtCentre(view(), 1.3)))).toBe(true);
  });

  it("offers 100% for a picture the window already shows whole", () => {
    // Fit and actual are the same scale here, so the toggle stays put.
    const small = fitView(50, 50, 200, 200);
    expect(toggleFitActual(small).scale).toBe(1);
  });
});

describe("viewOf", () => {
  it("keeps the zoom and the offsets when the window is resized", () => {
    const zoomed = actualView(view());
    const resized = viewOf(400, 200, 100, 100, zoomed);
    expect(resized.scale).toBe(1);
    expect(resized.viewW).toBe(100);
    // Still clamped to the new, smaller viewport.
    expect(resized.x).toBe(-100);
    expect(resized.y).toBe(0);
  });

  it("re-fits when the picture's natural size finally arrives", () => {
    const empty = viewOf(0, 0, 200, 200);
    const loaded = viewOf(400, 200, 200, 200, empty);
    expect(loaded.scale).toBe(0.5);
  });
});

describe("zoomPercent", () => {
  it("is the zoom as a whole number", () => {
    expect(zoomPercent(view())).toBe(50);
    expect(zoomPercent(actualView(view()))).toBe(100);
  });
});

describe("pinchFactor", () => {
  it("is the ratio of the two finger distances", () => {
    expect(pinchFactor(100, 200)).toBe(2);
    expect(pinchFactor(0, 200)).toBe(1);
  });
});

describe("the zoom limits", () => {
  it("are sane named constants", () => {
    expect(MIN_ZOOM).toBeLessThan(1);
    expect(MAX_ZOOM).toBeGreaterThan(1);
    expect(ZOOM_STEP).toBeGreaterThan(1);
    expect(WHEEL_ZOOM_STEP).toBeGreaterThan(1);
    expect(WHEEL_ZOOM_STEP).toBeLessThan(ZOOM_STEP);
  });
});
