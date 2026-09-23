/**
 * Per-browser preferences of the M1 client features: whether the tree shows
 * avatars, whether a connect subscribes to every channel, and the away
 * message presets. All in localStorage, each under its own key, and every
 * access guarded: private windows and full quotas throw, and a preference is
 * never worth an error.
 */
import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { addPreset, normalizePresets, removePreset } from "../ts/away-presets";
import { t } from "../i18n";

const AVATARS_KEY = "jinz.tree.avatars";
const SUBSCRIBE_ALL_KEY = "jinz.subscribeAll";
const PRESETS_KEY = "jinz.away.presets";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* the in-memory value still applies for this page */
  }
}

function readPresets(): string[] | null {
  const raw = read(PRESETS_KEY);
  if (!raw) return null;
  try {
    return normalizePresets(JSON.parse(raw));
  } catch {
    return null;
  }
}

export const useClientPrefsStore = defineStore("clientPrefs", () => {
  /** Avatars in the channel tree; the info panel and chat always show them. */
  const showTreeAvatars = ref(read(AVATARS_KEY) !== "0");
  /** Sent with every connect; off means only joined channels report their clients. */
  const subscribeAllOnConnect = ref(read(SUBSCRIBE_ALL_KEY) !== "0");
  /** Null until the user edits the list: then the defaults follow the UI language. */
  const savedPresets = ref<string[] | null>(readPresets());

  const awayPresets = computed(
    () =>
      savedPresets.value ?? [
        t("away.presetBrb"),
        t("away.presetLunch"),
        t("away.presetMeeting"),
        t("away.presetSleep"),
      ],
  );

  function setShowTreeAvatars(on: boolean): void {
    showTreeAvatars.value = on;
    write(AVATARS_KEY, on ? "1" : "0");
  }

  function setSubscribeAllOnConnect(on: boolean): void {
    subscribeAllOnConnect.value = on;
    write(SUBSCRIBE_ALL_KEY, on ? "1" : "0");
  }

  function savePresets(list: string[]): void {
    savedPresets.value = list;
    write(PRESETS_KEY, JSON.stringify(list));
  }

  function addAwayPreset(text: string): void {
    savePresets(addPreset(awayPresets.value, text));
  }

  function removeAwayPreset(text: string): void {
    savePresets(removePreset(awayPresets.value, text));
  }

  return {
    showTreeAvatars,
    subscribeAllOnConnect,
    awayPresets,
    setShowTreeAvatars,
    setSubscribeAllOnConnect,
    addAwayPreset,
    removeAwayPreset,
  };
});
