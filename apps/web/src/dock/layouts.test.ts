import { describe, expect, it } from "vitest";
import {
  edgeAt,
  findLayout,
  fractionPercent,
  layoutZoneBox,
  layoutZoneBoxFor,
  SNAP_LAYOUTS,
  type SnapLayout,
} from "./layouts";
import { snapBox } from "./snap";

/**
 * The layout table and its geometry, in the style of `snap.test.ts`: pure
 * maths, no DOM.
 *
 * The bulk of this file is the tiling invariant, checked over a spread of
 * desktop sizes that deliberately includes odd widths and heights and sizes
 * that divide badly by three — the cases where rounding each zone on its own
 * would leave a seam or a doubled pixel.
 */

/** Desktop sizes to hold every layout to: round, odd, prime, and tiny. */
const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1001, height: 769 },
  { width: 1279, height: 721 },
  { width: 100, height: 100 },
  { width: 101, height: 101 },
  { width: 7, height: 5 },
  { width: 3, height: 3 },
  { width: 1, height: 1 },
];

describe("SNAP_LAYOUTS", () => {
  it("offers the five Windows 11 layouts, in order", () => {
    expect(SNAP_LAYOUTS.map((l) => l.id)).toEqual([
      "even",
      "wide-left",
      "wide-right",
      "left-stack",
      "quarters",
    ]);
  });

  it("names every zone of a layout distinctly", () => {
    for (const layout of SNAP_LAYOUTS) {
      const ids = layout.zones.map((z) => z.id);
      expect(new Set(ids).size, `${layout.id} has duplicate zone ids`).toBe(ids.length);
    }
  });

  it("gives each layout the number of regions the thumbnail shows", () => {
    const counts = Object.fromEntries(SNAP_LAYOUTS.map((l) => [l.id, l.zones.length]));
    expect(counts).toEqual({
      even: 2,
      "wide-left": 2,
      "wide-right": 2,
      "left-stack": 3,
      quarters: 4,
    });
  });
});

describe("edgeAt", () => {
  it("pins both ends of the axis exactly", () => {
    for (const size of [1, 7, 100, 1001]) {
      expect(edgeAt([0, 1], size)).toBe(0);
      expect(edgeAt([1, 1], size)).toBe(size);
    }
  });

  it("never goes backwards as the fraction grows", () => {
    const size = 101;
    const edges = [
      edgeAt([0, 1], size),
      edgeAt([1, 3], size),
      edgeAt([1, 2], size),
      edgeAt([2, 3], size),
      edgeAt([1, 1], size),
    ];
    for (let i = 1; i < edges.length; i++) expect(edges[i]).toBeGreaterThanOrEqual(edges[i - 1]);
  });

  it("divides by three exactly, not through a floating fraction", () => {
    // 1/3 * 3 is 0.9999999999999999 in binary floating point; flooring that
    // would give 0 pixels where a third of three pixels is one.
    expect(edgeAt([1, 3], 3)).toBe(1);
    expect(edgeAt([2, 3], 3)).toBe(2);
    expect(edgeAt([1, 3], 300)).toBe(100);
  });
});

/** Every zone of `layout`, as boxes against that desktop. */
const boxesOf = (layout: SnapLayout, desktop: { width: number; height: number }) =>
  layout.zones.map((zone) => layoutZoneBox(zone, desktop));

describe("layoutZoneBox tiles the desktop exactly", () => {
  for (const layout of SNAP_LAYOUTS) {
    for (const desktop of SIZES) {
      const where = `${layout.id} on ${desktop.width}x${desktop.height}`;

      it(`keeps every zone inside the desktop — ${where}`, () => {
        for (const box of boxesOf(layout, desktop)) {
          expect(box.x, where).toBeGreaterThanOrEqual(0);
          expect(box.y, where).toBeGreaterThanOrEqual(0);
          expect(box.width, where).toBeGreaterThanOrEqual(0);
          expect(box.height, where).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width, where).toBeLessThanOrEqual(desktop.width);
          expect(box.y + box.height, where).toBeLessThanOrEqual(desktop.height);
        }
      });

      it(`overlaps no two zones and loses no pixel — ${where}`, () => {
        // A pixel-by-pixel count is the honest check: every pixel of the
        // desktop covered by exactly one zone is what "tiles exactly" means,
        // and it catches a seam and a doubled column with the same assertion.
        const boxes = boxesOf(layout, desktop);
        const cover = new Uint8Array(desktop.width * desktop.height);
        for (const box of boxes) {
          for (let y = box.y; y < box.y + box.height; y++) {
            for (let x = box.x; x < box.x + box.width; x++) cover[y * desktop.width + x] += 1;
          }
        }
        const doubled = cover.reduce((n, c) => n + (c > 1 ? 1 : 0), 0);
        const missed = cover.reduce((n, c) => n + (c === 0 ? 1 : 0), 0);
        expect({ doubled, missed }, where).toEqual({ doubled: 0, missed: 0 });
      });

      it(`adds the zones' areas up to the desktop's — ${where}`, () => {
        const area = boxesOf(layout, desktop).reduce((n, b) => n + b.width * b.height, 0);
        expect(area, where).toBe(desktop.width * desktop.height);
      });
    }
  }
});

describe("layoutZoneBoxFor", () => {
  it("agrees with Aero Snap's halves for the even layout", () => {
    // The two features must not disagree by a pixel about what "the left
    // half" is, on an odd width least of all.
    for (const desktop of SIZES) {
      expect(layoutZoneBoxFor("even", "left", desktop)).toEqual(snapBox("left", desktop));
      expect(layoutZoneBoxFor("even", "right", desktop)).toEqual(snapBox("right", desktop));
    }
  });

  it("agrees with Aero Snap's quarters for the quarters layout", () => {
    for (const desktop of SIZES) {
      for (const zone of ["top-left", "top-right", "bottom-left", "bottom-right"] as const) {
        expect(layoutZoneBoxFor("quarters", zone, desktop)).toEqual(snapBox(zone, desktop));
      }
    }
  });

  it("gives the wide column two thirds and its neighbour the rest", () => {
    const desktop = { width: 900, height: 600 };
    expect(layoutZoneBoxFor("wide-left", "left", desktop)).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 600,
    });
    expect(layoutZoneBoxFor("wide-left", "right", desktop)).toEqual({
      x: 600,
      y: 0,
      width: 300,
      height: 600,
    });
    expect(layoutZoneBoxFor("wide-right", "left", desktop)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 600,
    });
    expect(layoutZoneBoxFor("wide-right", "right", desktop)).toEqual({
      x: 300,
      y: 0,
      width: 600,
      height: 600,
    });
  });

  it("stacks two quarters beside a tall half", () => {
    const desktop = { width: 800, height: 600 };
    expect(layoutZoneBoxFor("left-stack", "left", desktop)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 600,
    });
    expect(layoutZoneBoxFor("left-stack", "right-top", desktop)).toEqual({
      x: 400,
      y: 0,
      width: 400,
      height: 300,
    });
    expect(layoutZoneBoxFor("left-stack", "right-bottom", desktop)).toEqual({
      x: 400,
      y: 300,
      width: 400,
      height: 300,
    });
  });

  it("returns null for ids that came from the DOM and mean nothing", () => {
    const desktop = { width: 800, height: 600 };
    expect(layoutZoneBoxFor("nope", "left", desktop)).toBeNull();
    expect(layoutZoneBoxFor("even", "middle", desktop)).toBeNull();
    expect(layoutZoneBoxFor("", "", desktop)).toBeNull();
  });
});

describe("findLayout", () => {
  it("finds each layout by id and nothing else", () => {
    for (const layout of SNAP_LAYOUTS) expect(findLayout(layout.id)).toBe(layout);
    expect(findLayout("thirds")).toBeNull();
  });
});

describe("fractionPercent", () => {
  it("turns a fraction into the percentage a thumbnail draws with", () => {
    expect(fractionPercent([0, 1])).toBe(0);
    expect(fractionPercent([1, 2])).toBe(50);
    expect(fractionPercent([1, 1])).toBe(100);
    expect(fractionPercent([2, 3])).toBeCloseTo(66.667, 3);
  });
});
