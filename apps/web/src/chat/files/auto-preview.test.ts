import { describe, expect, it } from "vitest";
import {
  AUTO_PREVIEW_MAX_BYTES,
  AUTO_PREVIEW_MAX_PER_MIN,
  AUTO_PREVIEW_WINDOW_MS,
  autoPreviewable,
  createAutoPreviewRate,
} from "./auto-preview";

const card = (over: Partial<Parameters<typeof autoPreviewable>[0]> = {}) => ({
  enabled: true,
  name: "cat.png",
  size: 1024,
  ...over,
});

describe("autoPreviewable", () => {
  it("takes a small picture shared through the hub", () => {
    expect(autoPreviewable(card())).toBe(true);
    expect(autoPreviewable(card({ size: AUTO_PREVIEW_MAX_BYTES }))).toBe(true);
  });

  it.each(["cat.png", "cat.JPG", "a.jpeg", "b.gif", "c.webp", "d.avif", "e.bmp"])(
    "takes %s",
    (name) => {
      expect(autoPreviewable(card({ name }))).toBe(true);
    },
  );

  it("leaves the card alone when the setting is off", () => {
    expect(autoPreviewable(card({ enabled: false }))).toBe(false);
  });

  it("leaves anything over the limit click-to-load", () => {
    expect(autoPreviewable(card({ size: AUTO_PREVIEW_MAX_BYTES + 1 }))).toBe(false);
  });

  it("needs a size: an unknown one could be huge", () => {
    expect(autoPreviewable(card({ size: undefined }))).toBe(false);
  });

  // SVG is a document that can carry scripts, so it is not a picture here.
  it.each(["notes.txt", "art.svg", "run.exe", "noext"])("leaves %s alone", (name) => {
    expect(autoPreviewable(card({ name }))).toBe(false);
  });

  it("does not try again once an auto-load failed", () => {
    expect(autoPreviewable(card({ failed: true }))).toBe(false);
  });
});

describe("createAutoPreviewRate", () => {
  it("allows a burst up to the cap, then refuses", () => {
    const rate = createAutoPreviewRate(3, 1000);
    expect([rate.take(0), rate.take(0), rate.take(0)]).toEqual([true, true, true]);
    expect(rate.take(0)).toBe(false);
  });

  it("lets the window slide: what fell out is free again", () => {
    const rate = createAutoPreviewRate(2, 1000);
    rate.take(0);
    rate.take(500);
    expect(rate.take(900)).toBe(false);
    // The take at 0 is now older than the window.
    expect(rate.take(1001)).toBe(true);
    expect(rate.take(1001)).toBe(false);
    expect(rate.take(1501)).toBe(true);
  });

  it("defaults to the hub-friendly cap for a minute", () => {
    const rate = createAutoPreviewRate();
    for (let i = 0; i < AUTO_PREVIEW_MAX_PER_MIN; i++) expect(rate.take(0)).toBe(true);
    expect(rate.take(0)).toBe(false);
    expect(rate.take(AUTO_PREVIEW_WINDOW_MS)).toBe(true);
  });

  it("keeps no more timestamps than the cap", () => {
    const rate = createAutoPreviewRate(2, 1000);
    for (let now = 0; now < 100; now++) rate.take(now * 10);
    expect(rate.size).toBeLessThanOrEqual(2);
  });
});
