import { describe, expect, it } from "vitest";
import { refitBox, refitBoxes, refitStates } from "./refit";
import { snapBox } from "./snap";
import { layoutZoneBoxFor } from "./layouts";
import { NO_WINDOWS, setMaximized, setMinimized } from "./windowState";

const FROM = { width: 1000, height: 600 };
const TO = { width: 1601, height: 901 };
const SMALL = { width: 700, height: 400 };

describe("refitBox", () => {
  it("keeps a maximised window filling the desktop", () => {
    expect(refitBox(snapBox("top", FROM), FROM, TO)).toEqual(snapBox("top", TO));
  });

  it("keeps a snapped half attached to its edge and still half the desktop", () => {
    expect(refitBox(snapBox("right", FROM), FROM, TO)).toEqual(snapBox("right", TO));
    expect(refitBox(snapBox("left", FROM), FROM, SMALL)).toEqual(snapBox("left", SMALL));
  });

  it("keeps a snapped quarter in its corner", () => {
    expect(refitBox(snapBox("bottom-right", FROM), FROM, TO)).toEqual(snapBox("bottom-right", TO));
  });

  it("keeps a Snap Layouts zone in its zone", () => {
    const from = layoutZoneBoxFor("wide-right", "right", FROM)!;
    expect(refitBox(from, FROM, TO)).toEqual(layoutZoneBoxFor("wide-right", "right", TO));
  });

  it("keeps a free window touching the right and bottom edges touching them", () => {
    const box = { x: 600, y: 350, width: 400, height: 250 };
    expect(refitBox(box, FROM, TO)).toEqual({ x: 1201, y: 651, width: 400, height: 250 });
  });

  it("keeps a free window at the top-left where it is", () => {
    const box = { x: 0, y: 0, width: 400, height: 250 };
    expect(refitBox(box, FROM, TO)).toEqual(box);
  });

  it("keeps a free window's size and its share of the space around it", () => {
    // Centred before (300 either side), centred after.
    const box = { x: 300, y: 100, width: 400, height: 200 };
    const out = refitBox(box, FROM, TO);
    expect(out.width).toBe(400);
    expect(out.height).toBe(200);
    expect(out.x).toBe(Math.round((TO.width - 400) / 2));
    expect(out.y).toBe(Math.round((TO.height - 200) / 4));
  });

  it("round-trips a free window through a shrink and back", () => {
    const box = { x: 450, y: 200, width: 300, height: 150 };
    expect(refitBox(refitBox(box, FROM, SMALL), SMALL, FROM)).toEqual(box);
  });

  it("puts a window larger than the new desktop at its top-left rather than off-screen", () => {
    const box = { x: 100, y: 50, width: 800, height: 500 };
    expect(refitBox(box, FROM, SMALL)).toEqual({ x: 0, y: 0, width: 800, height: 500 });
  });

  it("pulls a partly off-screen window back inside", () => {
    const box = { x: -50, y: 20, width: 300, height: 200 };
    expect(refitBox(box, FROM, TO).x).toBe(0);
  });
});

/** The starter layout: a full-height sidebar, one window above two side by side. */
const START = { width: 1400, height: 819 };
const TREE = { x: 0, y: 0, width: 280, height: 819 };
const VIDEO = { x: 280, y: 0, width: 1120, height: 352 };
const SERVER = { x: 280, y: 352, width: 560, height: 467 };
const INFO = { x: 840, y: 352, width: 560, height: 467 };

describe("refitBoxes", () => {
  it("keeps a tiled layout tiled: every shared edge and desktop edge follows the desktop", () => {
    const to = { width: 1700, height: 969 };
    const [tree, video, server, info] = refitBoxes([TREE, VIDEO, SERVER, INFO], START, to);
    // Desktop edges stay on the desktop's edges.
    expect(tree.x).toBe(0);
    expect(tree.y + tree.height).toBe(to.height);
    expect(video.x + video.width).toBe(to.width);
    expect(info.x + info.width).toBe(to.width);
    expect(info.y + info.height).toBe(to.height);
    // Seams stay seams: no gap and no overlap between neighbours.
    expect(video.x).toBe(tree.x + tree.width);
    expect(server.x).toBe(tree.x + tree.width);
    expect(info.x).toBe(server.x + server.width);
    expect(server.y).toBe(video.y + video.height);
    expect(info.y).toBe(video.y + video.height);
  });

  it("keeps it tiled on a shrinking desktop too", () => {
    const to = { width: 1200, height: 719 };
    const [tree, video, server, info] = refitBoxes([TREE, VIDEO, SERVER, INFO], START, to);
    expect(tree.y + tree.height).toBe(to.height);
    expect(video.x).toBe(tree.x + tree.width);
    expect(info.x).toBe(server.x + server.width);
    expect(info.x + info.width).toBe(to.width);
    expect(server.y).toBe(video.y + video.height);
  });

  it("moves a window docked to a neighbour's edge with that edge, keeping its size", () => {
    const side = { x: 0, y: 0, width: 300, height: 600 };
    const docked = { x: 300, y: 100, width: 200, height: 150 };
    const [newSide, newDocked] = refitBoxes([side, docked], FROM, TO);
    expect(newDocked.x).toBe(newSide.x + newSide.width);
    expect(newDocked.width).toBe(200);
    expect(newDocked.height).toBe(150);
  });

  it("does not treat windows that only line up, without touching, as a seam", () => {
    const upper = { x: 0, y: 0, width: 300, height: 100 };
    const apart = { x: 300, y: 300, width: 200, height: 150 };
    const [, moved] = refitBoxes([upper, apart], FROM, TO);
    expect(moved).toEqual(refitBox(apart, FROM, TO));
  });

  it("keeps an exact snap region exact even beside a tiled neighbour", () => {
    const left = snapBox("left", FROM);
    const right = snapBox("right", FROM);
    expect(refitBoxes([left, right], FROM, TO)).toEqual([
      snapBox("left", TO),
      snapBox("right", TO),
    ]);
  });
});

describe("refitStates", () => {
  it("refits the box a maximised window will restore to", () => {
    const restore = { x: 600, y: 0, width: 400, height: 300 };
    const states = setMaximized(NO_WINDOWS, "a", restore);
    const next = refitStates(states, FROM, TO);
    expect(next.a.restore).toEqual({ x: 1201, y: 0, width: 400, height: 300 });
    expect(states.a.restore).toEqual(restore);
  });

  it("returns the same map when nothing is maximised", () => {
    const states = setMinimized(NO_WINDOWS, "a", true);
    expect(refitStates(states, FROM, TO)).toBe(states);
  });
});
