import { describe, expect, it } from "vitest";
import {
  CUE_EVENTS,
  CUE_GROUPS,
  CUE_META,
  defaultSettings,
  eventsInGroup,
  isCueEvent,
  mergeSettings,
} from "./events";

describe("the event catalogue", () => {
  it("puts every event in exactly one listed group", () => {
    const grouped = CUE_GROUPS.flatMap(eventsInGroup);
    expect([...grouped].sort()).toEqual([...CUE_EVENTS].sort());
  });

  it("never offers a popup for things the user does themselves", () => {
    for (const e of eventsInGroup("toggles")) {
      expect(CUE_META[e].notifiable).toBe(false);
      expect(CUE_META[e].defaults.notify).toBe(false);
    }
  });

  it("defaults to popups for pokes and private messages, not for plain chat", () => {
    const d = defaultSettings();
    expect(d.events.poked).toEqual({ sound: true, notify: true });
    expect(d.events.privateMessage).toEqual({ sound: true, notify: true });
    expect(d.events.channelMessage.notify).toBe(false);
    expect(d.events.serverUserJoined.sound).toBe(false);
    // The permission prompt needs a click, so the master switch starts off.
    expect(d.notifications).toBe(false);
  });

  it("has a whisper cue: sounded by default, from someone else so it may pop up", () => {
    expect(isCueEvent("whisperReceived")).toBe(true);
    expect(CUE_META.whisperReceived.group).toBe("people");
    expect(CUE_META.whisperReceived.notifiable).toBe(true);
    expect(defaultSettings().events.whisperReceived).toEqual({ sound: true, notify: false });
  });

  it("recognises event names", () => {
    expect(isCueEvent("poked")).toBe(true);
    expect(isCueEvent("whisper")).toBe(false);
    expect(isCueEvent(3)).toBe(false);
  });
});

describe("mergeSettings", () => {
  it("returns the defaults for nothing or garbage", () => {
    expect(mergeSettings(null)).toEqual(defaultSettings());
    expect(mergeSettings("nope")).toEqual(defaultSettings());
  });

  it("keeps saved values and fills in events a newer build added", () => {
    const merged = mergeSettings({
      sounds: false,
      volume: 0.9,
      events: { poked: { sound: false, notify: false } },
    });
    expect(merged.sounds).toBe(false);
    expect(merged.volume).toBe(0.9);
    expect(merged.events.poked).toEqual({ sound: false, notify: false });
    expect(merged.events.privateMessage).toEqual(defaultSettings().events.privateMessage);
  });

  it("drops unknown events and wrongly typed fields", () => {
    const merged = mergeSettings({
      notifications: "yes",
      volume: 7,
      events: { bogus: { sound: true }, poked: { sound: "loud", notify: false } },
    });
    expect(merged.notifications).toBe(false);
    expect(merged.volume).toBe(1);
    expect("bogus" in merged.events).toBe(false);
    expect(merged.events.poked).toEqual({ sound: true, notify: false });
  });
});
