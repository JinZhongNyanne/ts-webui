import { describe, expect, it } from "vitest";
import {
  createThrottle,
  CUE_REPEAT_MS,
  NOTIFICATION_BODY_MAX,
  notificationBody,
  notificationPermission,
  soundCoveredElsewhere,
  wantsDesktopNotification,
  type AnnouncerState,
} from "./policy";

const quiet: AnnouncerState = {
  ttsEnabled: false,
  ttsReadsJoinLeave: true,
  ttsReadsPokes: true,
  ttsReadsChannelChat: true,
  ttsReadsServerChat: false,
  ttsReadsPrivateChat: true,
  hasEntrySound: () => false,
};

describe("soundCoveredElsewhere", () => {
  it("plays everything while TTS is off and nobody has an entry sound", () => {
    expect(soundCoveredElsewhere({ event: "channelUserJoined", uid: "a" }, quiet)).toBe(false);
    expect(soundCoveredElsewhere({ event: "poked" }, quiet)).toBe(false);
  });

  it("skips the join chime for someone with their own entry sound", () => {
    const a = { ...quiet, hasEntrySound: (uid: string) => uid === "a" };
    expect(soundCoveredElsewhere({ event: "channelUserJoined", uid: "a" }, a)).toBe(true);
    expect(soundCoveredElsewhere({ event: "channelUserJoined", uid: "b" }, a)).toBe(false);
    // Their entry sound only plays on arrival, so the leave chime still sounds.
    expect(soundCoveredElsewhere({ event: "channelUserLeft", uid: "a" }, a)).toBe(false);
  });

  it("leaves announcements TTS reads aloud to TTS", () => {
    const tts = { ...quiet, ttsEnabled: true };
    expect(soundCoveredElsewhere({ event: "channelUserJoined" }, tts)).toBe(true);
    expect(soundCoveredElsewhere({ event: "channelUserLeft" }, tts)).toBe(true);
    expect(soundCoveredElsewhere({ event: "poked" }, tts)).toBe(true);
    expect(soundCoveredElsewhere({ event: "privateMessage" }, tts)).toBe(true);
    expect(soundCoveredElsewhere({ event: "channelMessage" }, tts)).toBe(true);
    // Server chat is not read in this setup, so its chime stays.
    expect(soundCoveredElsewhere({ event: "serverMessage" }, tts)).toBe(false);
    // TTS never reads these.
    expect(soundCoveredElsewhere({ event: "micMuted" }, tts)).toBe(false);
    expect(soundCoveredElsewhere({ event: "serverUserJoined" }, tts)).toBe(false);
  });
});

describe("wantsDesktopNotification", () => {
  it("only fires when the user is looking elsewhere", () => {
    expect(wantsDesktopNotification({ hidden: false, focused: true })).toBe(false);
    expect(wantsDesktopNotification({ hidden: true, focused: false })).toBe(true);
    // Visible but another window has focus (side-by-side windows).
    expect(wantsDesktopNotification({ hidden: false, focused: false })).toBe(true);
  });
});

describe("notificationPermission", () => {
  it("reports a missing API as unsupported", () => {
    expect(notificationPermission(undefined)).toBe("unsupported");
    expect(notificationPermission({ permission: "denied" })).toBe("denied");
  });
});

describe("notificationBody", () => {
  it("joins sender and text and strips BBCode", () => {
    expect(
      notificationBody({ event: "privateMessage", name: "bob", text: "[b]hi[/b]  there" }),
    ).toBe("bob: hi there");
    expect(notificationBody({ event: "poked", name: "bob" })).toBe("bob");
    expect(notificationBody({ event: "connected" })).toBe("");
  });

  it("caps long messages", () => {
    const body = notificationBody({ event: "serverMessage", text: "x".repeat(500) });
    expect(body.length).toBe(NOTIFICATION_BODY_MAX);
    expect(body.endsWith("…")).toBe(true);
  });
});

describe("createThrottle", () => {
  it("drops a repeat of the same event inside the window", () => {
    const allow = createThrottle();
    expect(allow("channelUserJoined", 0)).toBe(true);
    expect(allow("channelUserJoined", CUE_REPEAT_MS - 1)).toBe(false);
    expect(allow("channelUserLeft", 10)).toBe(true);
    expect(allow("channelUserJoined", CUE_REPEAT_MS)).toBe(true);
  });

  it("measures from the last cue let through, so a steady stream keeps sounding", () => {
    const allow = createThrottle(100);
    const heard = [0, 50, 100, 150, 200, 250].filter((t) => allow("poked", t));
    expect(heard).toEqual([0, 100, 200]);
  });
});
