<script setup lang="ts">
/**
 * The server's host banner or host button image, behind the same
 * click-to-load gate as an `[img]` in chat (banner-gate.ts): an external
 * image tells its host the viewer's IP, and the server's owner chose the
 * address. It loads at once only from a host the chat's image allowlist
 * trusts, or one the viewer allowed for this server; otherwise it waits for
 * a click, once or "always for this server".
 *
 * The image links to `link` once shown, and only to an http(s) address: the
 * server's owner types that too, and a `javascript:` link must not run here.
 * The gate itself is never inside the link, so its buttons are plain buttons.
 */
import { computed, ref } from "vue";
import { useI18n } from "../../i18n";
import { useChatSettingsStore } from "../../stores/chatSettings";
import { useHubAccessStore } from "../../stores/hubAccess";
import { useTsStore } from "../../stores/ts";
import { historyServerKey } from "../../chat/history";
import { safeHttpUrl } from "../../ts/bbcode";
import { bannerDecision, consentKey } from "./banner-gate";
import { useBannerConsent } from "./useBannerConsent";

const props = defineProps<{
  url: string;
  variant: "banner" | "button";
  link?: string;
  title?: string;
}>();
const { t } = useI18n();
const ts = useTsStore();
const access = useHubAccessStore();
const chat = useChatSettingsStore();
const consent = useBannerConsent();

/** Loaded once by a click; not remembered. */
const once = ref("");

const serverKey = computed(() =>
  historyServerKey(
    { created: ts.server?.created ?? 0, name: ts.server?.name ?? "" },
    { host: ts.profile.host, port: ts.profile.port, fixed: access.fixedServer },
  ),
);

const decision = computed(() => {
  const d = bannerDecision(props.url, {
    serverKey: serverKey.value,
    consents: consent.consents.value,
    hostAllowed: (h) => chat.isImageHostAllowed(h),
  });
  return d.kind === "ask" && once.value === d.url ? { kind: "show" as const, url: d.url } : d;
});

const href = computed(() => (props.link ? safeHttpUrl(props.link) : null));

function always(host: string): void {
  consent.allow(consentKey(serverKey.value, host));
}
</script>

<template>
  <a
    v-if="decision.kind === 'show' && href"
    :class="`link-${variant}`"
    :href="href"
    :title="title || href"
    target="_blank"
    rel="noreferrer"
  >
    <img
      :class="variant"
      :src="decision.url"
      alt=""
      referrerpolicy="no-referrer"
      data-testid="host-image"
    />
  </a>
  <img
    v-else-if="decision.kind === 'show'"
    :class="variant"
    :src="decision.url"
    alt=""
    referrerpolicy="no-referrer"
    data-testid="host-image"
  />
  <span
    v-else-if="decision.kind === 'ask'"
    class="gate"
    :class="variant"
    data-testid="host-image-gate"
  >
    <button type="button" data-testid="host-image-load" @click="once = decision.url">
      🖼 {{ t("server.banner.load", { host: decision.host }) }}
    </button>
    <button
      type="button"
      class="always"
      data-testid="host-image-always"
      @click="always(decision.host)"
    >
      {{ t("server.banner.always") }}
    </button>
  </span>
</template>

<style scoped>
img.banner {
  display: block;
  width: 100%;
}
.link-banner {
  display: block;
}
img.button {
  height: 28px;
  border-radius: 4px;
}
.gate {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}
.gate.banner {
  padding: 10px;
  justify-content: center;
  background: var(--bg);
}
.gate button {
  font-size: 12px;
  padding: 4px 8px;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.gate .always {
  color: var(--text-dim);
}
</style>
