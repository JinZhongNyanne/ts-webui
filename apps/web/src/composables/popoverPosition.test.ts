import { describe, expect, it } from "vitest";
import { anchorAbove, POPOVER_GAP, popoverLimits } from "./popoverPosition";

const viewport = { width: 1000, height: 800 };
const panel = { width: 200, height: 120 };
/** A button in the middle of the desktop, with room on every side. */
const trigger = { x: 400, y: 400, width: 60, height: 24 };

describe("anchorAbove", () => {
  it("sits a gap above the trigger with their left edges in line", () => {
    expect(anchorAbove(trigger, panel, viewport)).toEqual({
      left: 400,
      top: 400 - POPOVER_GAP - panel.height,
    });
  });

  it("lines the right edges up instead when the trigger hangs off a bar's end", () => {
    expect(anchorAbove(trigger, panel, viewport, "end")).toEqual({
      left: 400 + 60 - 200,
      top: 400 - POPOVER_GAP - panel.height,
    });
  });

  it("flips below the trigger when there is no room above it", () => {
    const high = { x: 400, y: 20, width: 60, height: 24 };
    expect(anchorAbove(high, panel, viewport)).toEqual({ left: 400, top: 20 + 24 + POPOVER_GAP });
  });

  it("stays above and is pushed to the top margin when it fits on neither side", () => {
    const tall = { width: 200, height: 780 };
    expect(anchorAbove(trigger, tall, viewport)).toEqual({ left: 400, top: 8 });
  });

  it("pulls a popover that would hang off the right edge back inside", () => {
    const nearRight = { x: 950, y: 400, width: 40, height: 24 };
    expect(anchorAbove(nearRight, panel, viewport).left).toBe(1000 - 200 - 8);
  });

  it("never crosses the left margin, even for a trigger in the corner", () => {
    const corner = { x: 0, y: 0, width: 40, height: 24 };
    expect(anchorAbove(corner, panel, viewport, "end")).toEqual({ left: 8, top: 24 + POPOVER_GAP });
  });

  /*
   * A phone's on-screen keyboard shrinks the visual viewport without moving the
   * layout viewport an inch, so the space actually on screen is a box with an
   * origin of its own. The clamps have to respect that origin, or a popover is
   * "inside the viewport" and behind the keyboard at the same time.
   */
  describe("inside a shifted visual viewport", () => {
    /** The top 500px of a 390×844 phone, the rest taken by the keyboard. */
    const visible = { left: 0, top: 0, width: 390, height: 500 };

    it("pushes a popover up out of the space the keyboard took", () => {
      const composer = { x: 8, y: 460, width: 40, height: 40 };
      expect(anchorAbove(composer, { width: 374, height: 300 }, visible).top).toBe(
        460 - POPOVER_GAP - 300,
      );
    });

    it("keeps it inside the visible box rather than the layout viewport", () => {
      const low = { x: 8, y: 300, width: 40, height: 40 };
      const tall = { width: 374, height: 400 };
      // Above would start at -108 and below would end at 740, so it is clamped
      // to the top margin of the *visible* box, not of the 844px page.
      expect(anchorAbove(low, tall, visible).top).toBe(8);
    });

    it("offsets both clamps by a visual viewport that has been scrolled", () => {
      const shifted = { left: 40, top: 120, width: 300, height: 400 };
      const trigger = { x: 40, y: 130, width: 20, height: 20 };
      expect(anchorAbove(trigger, { width: 400, height: 500 }, shifted)).toEqual({
        left: 40 + 8,
        top: 120 + 8,
      });
    });
  });
});

describe("popoverLimits", () => {
  it("leaves a popover the visible box less a margin on each side", () => {
    expect(popoverLimits({ width: 390, height: 500 })).toEqual({ maxWidth: 374, maxHeight: 484 });
  });

  it("never answers a negative size for a viewport smaller than the margins", () => {
    expect(popoverLimits({ width: 4, height: 2 })).toEqual({ maxWidth: 0, maxHeight: 0 });
  });
});
