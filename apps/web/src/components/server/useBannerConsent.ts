/**
 * The host-banner consents (banner-gate.ts), kept in this browser. One list
 * for the whole page, shared by every component that shows a banner, so
 * allowing it in one place shows it everywhere at once.
 */
import { computed, shallowRef } from "vue";
import { normalizeConsents, withConsent } from "./banner-gate";

const KEY = "jinz.server.bannerConsents";

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    return normalizeConsents(raw ? JSON.parse(raw) : null);
  } catch {
    // Unreadable or blocked storage: nothing has been allowed yet.
    return [];
  }
}

const consents = shallowRef<readonly string[]>(load());

export function useBannerConsent() {
  function allow(key: string): void {
    consents.value = withConsent(consents.value, key);
    try {
      localStorage.setItem(KEY, JSON.stringify(consents.value));
    } catch {
      // Storage full or blocked: the choice still holds for this page.
    }
  }
  return { consents: computed(() => new Set(consents.value)), allow };
}
