import { describe, expect, it } from "vitest";
import type { Box } from "./box";
import { dwellingFor } from "./snapFeedback";
import { DWELL_MS, dwell, NO_DWELL } from "./snapDwell";

/**
 * The one rule both drags share: what the desktop shows while the half second
 * is still running. Pure, so it is checked here rather than in a browser; what
 * the two states then *look* like is CSS, and is verified against a real
 * browser instead.
 */

const BOX: Box = { x: 0, y: 0, width: 500, height: 600 };
const AT = { x: 10, y: 10 };

describe("dwellingFor", () => {
  it("offers the box to the pre-arm cue while the wait is still running", () => {
    const waited = dwell(NO_DWELL, { target: "zone:left", at: AT, now: 1000 });
    expect(dwellingFor(BOX, waited)).toEqual({ box: BOX, since: 1000 });
  });

  it("offers nothing once the wait is served, because the armed preview takes over", () => {
    const first = dwell(NO_DWELL, { target: "zone:left", at: AT, now: 1000 });
    const served = dwell(first.state, { target: "zone:left", at: AT, now: 1000 + DWELL_MS });
    expect(served.ready).toBe(true);
    expect(dwellingFor(BOX, served)).toBeNull();
  });

  it("offers nothing when the target has no box to promise", () => {
    // A window-to-window nudge with no gap to fill previews nothing when it
    // arms, so promising something beforehand would be the very lie this cue
    // exists to stop.
    const waited = dwell(NO_DWELL, { target: "window:left-of-chat", at: AT, now: 1000 });
    expect(dwellingFor(null, waited)).toBeNull();
  });

  it("reports the restarted clock when the drag drifts, so the cue starts over", () => {
    const first = dwell(NO_DWELL, { target: "zone:left", at: AT, now: 1000 });
    const drifted = dwell(first.state, { target: "zone:left", at: { x: 400, y: 400 }, now: 1200 });
    expect(dwellingFor(BOX, drifted)).toEqual({ box: BOX, since: 1200 });
  });

  it("keeps the wait's own start, not the frame's, so the cue is not restarted by a move", () => {
    const first = dwell(NO_DWELL, { target: "zone:left", at: AT, now: 1000 });
    const still = dwell(first.state, { target: "zone:left", at: { x: 12, y: 12 }, now: 1200 });
    expect(dwellingFor(BOX, still)).toEqual({ box: BOX, since: 1000 });
  });
});
