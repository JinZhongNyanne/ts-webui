import { describe, expect, it } from "vitest";
import { LOCKED_MODE, modeRefusal, radioTransition } from "./radio.js";

const ok = { status: 200, body: { message: "done" } };

describe("radioTransition", () => {
  it("starts FM when the bot accepted it", () => {
    expect(radioTransition("POST", "/player/b1/fm", { platform: "qq" }, ok)).toEqual({
      botId: "b1",
      radio: "fm",
    });
  });

  it("does not start FM the bot refused, even with HTTP 200", () => {
    const refused = { status: 200, body: { ok: false, message: "No FM songs available" } };
    expect(radioTransition("POST", "/player/b1/fm", {}, refused)).toBeNull();
    expect(radioTransition("POST", "/player/b1/fm", {}, { status: 403, body: {} })).toBeNull();
  });

  it("starts a recommendation when the browser marks the playlist as one", () => {
    const body = { playlistId: "9", platform: "netease", radio: "recommend" };
    expect(radioTransition("POST", "/player/b1/play-playlist", body, ok)).toEqual({
      botId: "b1",
      radio: "recommend",
    });
  });

  it("ends the lock when something else replaces the queue", () => {
    for (const action of ["play", "play-song", "play-playlist", "play-album", "clear", "stop"]) {
      expect(radioTransition("POST", `/player/b1/${action}`, {}, ok)).toEqual({
        botId: "b1",
        radio: null,
      });
    }
  });

  it("leaves the lock alone for everything else", () => {
    for (const action of ["next", "pause", "add-song", "play-now-song", "volume", "mode"]) {
      expect(radioTransition("POST", `/player/b1/${action}`, {}, ok)).toBeNull();
    }
    expect(radioTransition("GET", "/player/b1/queue", undefined, ok)).toBeNull();
    expect(radioTransition("POST", "/music/search", {}, ok)).toBeNull();
  });

  it("does not end the lock on a call that failed", () => {
    expect(radioTransition("POST", "/player/b1/clear", {}, { status: 403, body: {} })).toBeNull();
  });
});

describe("modeRefusal", () => {
  const radioOf = (id: string) => (id === "b1" ? "fm" : null);

  it("refuses any mode but sequential while a radio plays", () => {
    expect(modeRefusal("POST", "/player/b1/mode", { mode: "random" }, radioOf)).toBe(
      "music.modeLocked",
    );
  });

  it("lets sequential through", () => {
    expect(modeRefusal("POST", "/player/b1/mode", { mode: LOCKED_MODE }, radioOf)).toBeNull();
  });

  it("ignores bots without a radio and other routes", () => {
    expect(modeRefusal("POST", "/player/b2/mode", { mode: "random" }, radioOf)).toBeNull();
    expect(modeRefusal("POST", "/player/b1/next", {}, radioOf)).toBeNull();
  });
});
