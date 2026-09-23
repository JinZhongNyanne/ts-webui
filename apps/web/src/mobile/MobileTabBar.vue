<script setup lang="ts">
/**
 * Bottom tab bar: the mobile replacement for the dock's panels. Which tabs
 * exist is decided by `tabs.ts`; this only draws them.
 */
import { computed } from "vue";
import { useI18n } from "../i18n";
import type { MobileTabId } from "./tabs";

const props = defineProps<{
  tabs: readonly MobileTabId[];
  active: MobileTabId;
  /** Unread messages across all conversations, shown on the chat tab. */
  unread: number;
  /** Someone is publishing video or a screen, shown on the video tab. */
  liveVideo: boolean;
}>();
defineEmits<{ select: [tab: MobileTabId] }>();
const { t } = useI18n();

const ICONS: Record<MobileTabId, string> = {
  tree: "👥",
  chat: "💬",
  video: "🎥",
  music: "🎵",
};

const LABEL_KEYS = {
  tree: "mobile.tabTree",
  chat: "mobile.tabChat",
  video: "mobile.tabVideo",
  music: "mobile.tabMusic",
} as const;

/** Badge text per tab; empty means no badge. A big count is capped, as usual. */
const badges = computed<Record<string, string>>(() => ({
  chat: props.unread > 0 ? (props.unread > 99 ? "99+" : String(props.unread)) : "",
  video: props.liveVideo ? "●" : "",
}));
</script>

<template>
  <nav class="tabbar glass-host" role="tablist">
    <button
      v-for="tab in tabs"
      :key="tab"
      type="button"
      role="tab"
      class="tab"
      :class="{ active: tab === active }"
      :aria-selected="tab === active"
      @click="$emit('select', tab)"
    >
      <span class="icon">
        {{ ICONS[tab] }}
        <span v-if="badges[tab]" class="badge" :class="{ dot: badges[tab] === '●' }">
          {{ badges[tab] === "●" ? "" : badges[tab] }}
        </span>
      </span>
      <span class="label">{{ t(LABEL_KEYS[tab]) }}</span>
    </button>
  </nav>
</template>

<style scoped>
.tabbar {
  flex: none;
  display: flex;
  border-top: 1px solid var(--border);
  background: var(--bg-elev);
  /* Above the home indicator, so the last row is not half a gesture area, and
     clear of the rounded corners a landscape phone puts at either end. */
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}
.tab {
  flex: 1;
  min-height: 52px;
  /* The base rule cannot reach this one, which sets its own height. */
  min-width: var(--touch-target);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--text-dim);
  padding: 4px 2px;
}
.tab.active {
  color: var(--accent);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.icon {
  position: relative;
  font-size: 18px;
  line-height: 1;
}
.label {
  font-size: 11px;
  line-height: 1;
}
.badge {
  position: absolute;
  top: -6px;
  left: 12px;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--danger);
  color: #fff;
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}
.badge.dot {
  min-width: 8px;
  width: 8px;
  height: 8px;
  padding: 0;
  background: var(--ok);
}
</style>
