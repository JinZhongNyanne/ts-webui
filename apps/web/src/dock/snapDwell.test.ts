import { describe, expect, it } from "vitest";
import { DWELL_MS, DWELL_TOLERANCE, NO_DWELL, dwell, type DwellState } from "./snapDwell";

/**
 * The dwell every snap now waits out. Timestamps are handed in, so the whole
 * rule is exercised without a clock, fake or otherwise.
 */

const AT = { x: 100, y: 100 };

/** One frame: the target armed, where the drag is, and when. */
const frame = (state: DwellState, target: string | null, now: number, at = AT) =>
  dwell(state, { target, at, now });

/** Rests on `target` from `now` until the dwell is satisfied, and returns the result. */
function rest(target: string, now = 0, at = AT) {
  const first = frame(NO_DWELL, target, now, at);
  return frame(first.state, target, now + DWELL_MS, at);
}

describe("dwell", () => {
  it("is not ready on the frame a target is first armed", () => {
    const { ready } = frame(NO_DWELL, "zone:left", 0);
    expect(ready).toBe(false);
  });

  it("is still not ready a moment short of the dwell", () => {
    const first = frame(NO_DWELL, "zone:left", 0);
    expect(frame(first.state, "zone:left", DWELL_MS - 1).ready).toBe(false);
  });

  it("is ready once the drag has rested on the target for the dwell", () => {
    expect(rest("zone:left").ready).toBe(true);
  });

  it("forgets everything the moment nothing is armed", () => {
    const { state } = rest("zone:left");
    const away = frame(state, null, DWELL_MS + 1);
    expect(away.ready).toBe(false);
    expect(away.state).toEqual(NO_DWELL);
  });

  it("starts the dwell over when the drag leaves the target and comes back", () => {
    const settled = rest("zone:left");
    const away = frame(settled.state, null, DWELL_MS);
    const back = frame(away.state, "zone:left", DWELL_MS + 10);
    expect(back.ready).toBe(false);
    expect(frame(back.state, "zone:left", DWELL_MS + 10 + DWELL_MS).ready).toBe(true);
  });

  it("starts over for a different target rather than inheriting the first one's wait", () => {
    // Almost through the left half's dwell, then the pointer arms the right:
    // the right must wait its own half second, not finish the left's.
    const first = frame(NO_DWELL, "zone:left", 0);
    const other = frame(first.state, "zone:right", DWELL_MS - 1);
    expect(other.ready).toBe(false);
    expect(frame(other.state, "zone:right", DWELL_MS).ready).toBe(false);
    expect(frame(other.state, "zone:right", 2 * DWELL_MS - 1).ready).toBe(true);
  });

  it("carries a served dwell over to the next target the drag reaches", () => {
    // The wait is served once per drag, not once per target: having held the
    // drag still for half a second, the user is plainly aiming, so the next
    // target arms at once and the preview glides across to it.
    const settled = rest("zone:left");
    const next = frame(settled.state, "zone:right", DWELL_MS + 20, { x: 900, y: 100 });
    expect(next.ready).toBe(true);
    expect(next.state).toEqual({
      target: "zone:right",
      at: { x: 900, y: 100 },
      since: DWELL_MS + 20,
      settled: true,
    });
  });

  it("starts over when the drag passed through nothing between two targets", () => {
    // Leaving every target is what says the user has stopped aiming, so the
    // carried wait is spent by it and the next target earns its own.
    const settled = rest("zone:left");
    const away = frame(settled.state, null, DWELL_MS + 10);
    const next = frame(away.state, "zone:right", DWELL_MS + 20);
    expect(next.ready).toBe(false);
    expect(frame(next.state, "zone:right", 2 * DWELL_MS + 20).ready).toBe(true);
  });

  it("arms nothing at the next target when the first one was never served", () => {
    // A flick has nothing to carry: neither edge it crossed was ever rested on.
    const first = frame(NO_DWELL, "zone:left", 0);
    const second = frame(first.state, "zone:right", 60, { x: 900, y: 100 });
    const third = frame(second.state, "zone:top", 120, { x: 500, y: 4 });
    expect([first.ready, second.ready, third.ready]).toEqual([false, false, false]);
  });

  it("tolerates the wobble of a hand trying to hold still", () => {
    const first = frame(NO_DWELL, "zone:left", 0, AT);
    const wobble = frame(first.state, "zone:left", 100, { x: AT.x + DWELL_TOLERANCE, y: AT.y });
    expect(frame(wobble.state, "zone:left", DWELL_MS).ready).toBe(true);
  });

  it("restarts the wait when the drag moves further than the wobble allows", () => {
    const first = frame(NO_DWELL, "zone:left", 0, AT);
    const to = { x: AT.x, y: AT.y + DWELL_TOLERANCE + 1 };
    const moved = frame(first.state, "zone:left", 100, to);
    expect(frame(moved.state, "zone:left", DWELL_MS, to).ready).toBe(false);
    expect(frame(moved.state, "zone:left", 100 + DWELL_MS, to).ready).toBe(true);
  });

  it("keeps a satisfied dwell through any amount of later movement", () => {
    // Once the preview is up, the armed target is held by the snap rules' own
    // hysteresis; re-imposing the rest test would flicker it off.
    const settled = rest("zone:left");
    const shoved = frame(settled.state, "zone:left", DWELL_MS + 16, { x: 400, y: 400 });
    expect(shoved.ready).toBe(true);
  });

  it("never snaps a drag that was flicked past the target", () => {
    // Three frames, 60ms apart, each at a different edge: nothing arms.
    const a = frame(NO_DWELL, "zone:left", 0);
    const b = frame(a.state, "zone:top-left", 60);
    const c = frame(b.state, "zone:top", 120);
    expect([a.ready, b.ready, c.ready]).toEqual([false, false, false]);
  });

  it("waits half a second, which is what the user asked for", () => {
    expect(DWELL_MS).toBe(500);
  });
});
