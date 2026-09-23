import { describe, expect, it } from "vitest";
import { cascadeBox, ICON_GUTTER, starterDesktop } from "./placement";
import type { Box } from "./box";

const DESKTOP = { width: 1600, height: 900 };
/** The starter layout must hold its shape on a laptop, a phone-ish window and a wall. */
const DESKTOPS = [DESKTOP, { width: 800, height: 600 }, { width: 2560, height: 1440 }];
const ALL = { video: true, music: true, files: true };

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

describe("cascadeBox", () => {
  it("puts the first window near the top-left, at its preferred size", () => {
    const box = cascadeBox(0, DESKTOP);
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    expect(box.width).toBe(720);
    expect(box.height).toBe(480);
  });

  it("steps each further window down and to the right", () => {
    const first = cascadeBox(0, DESKTOP);
    const second = cascadeBox(1, DESKTOP);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("wraps back to the start rather than walking off the desktop", () => {
    for (let i = 0; i < 40; i++) {
      const box = cascadeBox(i, DESKTOP);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(right(box)).toBeLessThanOrEqual(DESKTOP.width);
      expect(bottom(box)).toBeLessThanOrEqual(DESKTOP.height);
    }
  });

  it("shrinks the window to fit a small desktop", () => {
    const box = cascadeBox(0, { width: 500, height: 400 });
    expect(right(box)).toBeLessThanOrEqual(500);
    expect(bottom(box)).toBeLessThanOrEqual(400);
  });

  it("never places a window outside the desktop, even on a desktop smaller than the minimum floor", () => {
    const box = cascadeBox(0, { width: 150, height: 150 });
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(right(box)).toBeLessThanOrEqual(150);
    expect(bottom(box)).toBeLessThanOrEqual(150);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("starts clear of the icon gutter on a normal desktop", () => {
    for (let i = 0; i < 40; i++) {
      const box = cascadeBox(i, DESKTOP);
      expect(box.x).toBeGreaterThanOrEqual(ICON_GUTTER);
    }
  });
});

describe("starterDesktop", () => {
  it("opens the tree, the chat and the info panel, plus video and music", () => {
    expect(starterDesktop(ALL, DESKTOP).map((w) => w.id)).toEqual([
      "tree",
      "video",
      "chat",
      "info",
      "music",
    ]);
  });

  it("names each window's panel, so the chat is the server chat", () => {
    const chat = starterDesktop(ALL, DESKTOP).find((w) => w.id === "chat");
    expect(chat?.panelId).toBe("chat:server");
  });

  it("leaves out what the hub does not offer", () => {
    const ids = starterDesktop({ video: false, music: false, files: false }, DESKTOP).map(
      (w) => w.id,
    );
    expect(ids).toEqual(["tree", "chat", "info"]);
  });

  it.each(DESKTOPS)(
    "tiles the desktop %o: every window inside it, none overlapping, no gaps",
    (desk) => {
      const windows = starterDesktop(ALL, desk);
      for (const w of windows) {
        expect(w.box.x).toBeGreaterThanOrEqual(0);
        expect(w.box.y).toBeGreaterThanOrEqual(0);
        expect(right(w.box)).toBeLessThanOrEqual(desk.width);
        expect(bottom(w.box)).toBeLessThanOrEqual(desk.height);
        expect(w.box.width).toBeGreaterThan(0);
        expect(w.box.height).toBeGreaterThan(0);
      }
      for (let i = 0; i < windows.length; i++) {
        for (let j = i + 1; j < windows.length; j++) {
          const a = windows[i]!.box;
          const b = windows[j]!.box;
          const apart = right(a) <= b.x || right(b) <= a.x || bottom(a) <= b.y || bottom(b) <= a.y;
          expect(apart, `${windows[i]!.id} overlaps ${windows[j]!.id}`).toBe(true);
        }
      }
      // No overlaps plus the full area accounted for means no gaps either.
      const covered = windows.reduce((sum, w) => sum + w.box.width * w.box.height, 0);
      expect(covered).toBe(desk.width * desk.height);
    },
  );

  it.each(DESKTOPS)(
    "spans the whole width of desktop %o, leaving no blank column beside the icons",
    (desk) => {
      const windows = starterDesktop(ALL, desk);
      expect(Math.min(...windows.map((w) => w.box.x))).toBe(0);
      expect(Math.max(...windows.map((w) => right(w.box)))).toBe(desk.width);
    },
  );

  it.each(DESKTOPS)(
    "keeps the tree's fifth of desktop %o and the music column's quarter, of the full width",
    (desk) => {
      const windows = starterDesktop(ALL, desk);
      const tree = windows.find((w) => w.id === "tree")!.box;
      const music = windows.find((w) => w.id === "music")!.box;
      expect(tree.width).toBe(Math.round(desk.width * 0.2));
      expect(music.width).toBe(Math.round(desk.width * 0.26));
      expect(tree.x).toBe(0);
      expect(right(music)).toBe(desk.width);
    },
  );

  it("gives the tree's width back to the middle column when there is no music", () => {
    const windows = starterDesktop({ ...ALL, music: false }, DESKTOP);
    const chat = windows.find((w) => w.id === "chat")!.box;
    const info = windows.find((w) => w.id === "info")!.box;
    expect(chat.x).toBe(Math.round(DESKTOP.width * 0.2));
    expect(right(info)).toBe(DESKTOP.width);
  });

  it("stacks the video over the chat and info row", () => {
    const windows = starterDesktop(ALL, DESKTOP);
    const video = windows.find((w) => w.id === "video")!.box;
    const chat = windows.find((w) => w.id === "chat")!.box;
    expect(bottom(video)).toBeLessThanOrEqual(chat.y);
    expect(video.height).toBe(Math.round(DESKTOP.height * 0.43));
  });

  it("gives the middle column the whole height when there is no video", () => {
    const windows = starterDesktop({ ...ALL, video: false }, DESKTOP);
    const chat = windows.find((w) => w.id === "chat")!.box;
    expect(chat.y).toBe(0);
    expect(bottom(chat)).toBe(DESKTOP.height);
  });
});
