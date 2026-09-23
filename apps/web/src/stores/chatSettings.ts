import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import {
  clampRetention,
  normalizeChatSettings,
  withImageHost,
  withoutImageHost,
  type ChatSettings,
} from "../chat/settings";

const KEY = "jinz.chat.settings";

function load(): ChatSettings {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeChatSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeChatSettings(null);
  }
}

/** Chat preferences for this browser (local history, image hosts, sticker previews). */
export const useChatSettingsStore = defineStore("chatSettings", () => {
  const settings = ref<ChatSettings>(load());

  watch(
    settings,
    (s) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(s));
      } catch {
        // Storage full or blocked: the setting still applies for this page.
      }
    },
    { deep: true },
  );

  const imageHosts = computed(() => new Set(settings.value.imageHosts));

  function isImageHostAllowed(host: string): boolean {
    return imageHosts.value.has(host.toLowerCase());
  }

  function allowImageHost(host: string): void {
    settings.value = withImageHost(settings.value, host);
  }

  function forgetImageHost(host: string): void {
    settings.value = withoutImageHost(settings.value, host);
  }

  function setHistoryEnabled(on: boolean): void {
    settings.value = { ...settings.value, historyEnabled: on };
  }

  function setRetentionDays(days: number): void {
    settings.value = { ...settings.value, retentionDays: clampRetention(days) };
  }

  function setAutoImages(on: boolean): void {
    settings.value = { ...settings.value, autoImages: on };
  }

  return {
    settings,
    isImageHostAllowed,
    allowImageHost,
    forgetImageHost,
    setHistoryEnabled,
    setRetentionDays,
    setAutoImages,
  };
});
