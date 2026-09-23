import { beforeEach, describe, expect, it } from "vitest";
import {
  closeSettings,
  openSettings,
  resolveSettingsTab,
  settingsOpen,
  settingsTab,
  settingsTabs,
} from "./settings-panel";

describe("settingsTabs", () => {
  it("offers every tab on the desktop", () => {
    const ids = settingsTabs(false).map((tab) => tab.id);
    expect(ids).toContain("hotkeys");
    expect(ids).toContain("advanced");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers the whisper tab on both, since blocking whispers needs no keyboard", () => {
    expect(settingsTabs(false).map((tab) => tab.id)).toContain("whisper");
    expect(settingsTabs(true).map((tab) => tab.id)).toContain("whisper");
  });

  it("drops the keyboard-only tabs on a phone", () => {
    expect(settingsTabs(true).map((tab) => tab.id)).not.toContain("hotkeys");
  });
});

describe("resolveSettingsTab", () => {
  it("keeps a tab that is offered", () => {
    expect(resolveSettingsTab("theme", true)).toBe("theme");
    expect(resolveSettingsTab("hotkeys", false)).toBe("hotkeys");
  });

  it("falls back to the first tab when the one asked for is not offered", () => {
    expect(resolveSettingsTab("hotkeys", true)).toBe(settingsTabs(true)[0]!.id);
  });
});

describe("openSettings", () => {
  beforeEach(() => {
    closeSettings();
    settingsTab.value = "profile";
  });

  it("opens on the tab asked for", () => {
    openSettings("mic");
    expect(settingsOpen.value).toBe(true);
    expect(settingsTab.value).toBe("mic");
  });

  it("reopens where it was left when no tab is given", () => {
    openSettings("theme");
    closeSettings();
    expect(settingsOpen.value).toBe(false);
    openSettings();
    expect(settingsTab.value).toBe("theme");
  });
});
