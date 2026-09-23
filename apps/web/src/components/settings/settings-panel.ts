/**
 * The settings panel: one dialog for everything that is set once and rarely
 * revisited, so the status bar keeps only what is used during a call.
 *
 * Open state lives here, module-wide, because the panel is opened from several
 * places (the status-bar gear, the phone's voice bar and menu sheet) and
 * rendered once, by App.vue.
 */
import { ref } from "vue";
import type { MessageKey } from "../../i18n";

export type SettingsTab =
  | "profile"
  | "mic"
  | "playback"
  | "hotkeys"
  | "whisper"
  | "tts"
  | "chat"
  | "notify"
  | "theme"
  | "language"
  | "advanced";

export interface SettingsTabInfo {
  id: SettingsTab;
  icon: string;
  label: MessageKey;
}

const TABS: readonly SettingsTabInfo[] = [
  { id: "profile", icon: "👤", label: "profile.button" },
  { id: "mic", icon: "🎙️", label: "voice.tabMic" },
  { id: "playback", icon: "🔊", label: "voice.tabPlayback" },
  { id: "hotkeys", icon: "⌨️", label: "hotkeys.tab" },
  { id: "whisper", icon: "🤫", label: "whisper.tab" },
  { id: "tts", icon: "🗣️", label: "tts.title" },
  { id: "chat", icon: "💬", label: "chatSettings.title" },
  { id: "notify", icon: "🔔", label: "notify.title" },
  { id: "theme", icon: "🎨", label: "theme.title" },
  { id: "language", icon: "🌐", label: "profile.language" },
  { id: "advanced", icon: "🛠️", label: "settings.advanced" },
];

/** Hotkeys need a keyboard; a phone gets no tab for them. */
const DESKTOP_ONLY: ReadonlySet<SettingsTab> = new Set(["hotkeys"]);

export function settingsTabs(mobile: boolean): readonly SettingsTabInfo[] {
  return mobile ? TABS.filter((tab) => !DESKTOP_ONLY.has(tab.id)) : TABS;
}

/** The tab to show: the one asked for, or the first when it is not offered here. */
export function resolveSettingsTab(wanted: SettingsTab, mobile: boolean): SettingsTab {
  const tabs = settingsTabs(mobile);
  return tabs.some((tab) => tab.id === wanted) ? wanted : tabs[0]!.id;
}

export const settingsOpen = ref(false);
/** Last tab shown; kept while closed so the gear reopens where the user was. */
export const settingsTab = ref<SettingsTab>("profile");

/** Opens the panel, on `tab` if given, else where it was last left. */
export function openSettings(tab?: SettingsTab): void {
  if (tab) settingsTab.value = tab;
  settingsOpen.value = true;
}

export function closeSettings(): void {
  settingsOpen.value = false;
}
