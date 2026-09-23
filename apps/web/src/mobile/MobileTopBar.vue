<script setup lang="ts">
/**
 * The phone's title bar: who you are, where you are, and the way into
 * everything the desktop status bar holds.
 */
import { computed } from "vue";
import { useTsStore } from "../stores/ts";
import { useI18n } from "../i18n";

defineEmits<{ "open-menu": [] }>();
const ts = useTsStore();
const { t } = useI18n();

const connected = computed(() => ts.connState === "connected");
const nickname = computed(() => {
  if (connected.value) return ts.selfClient?.nickname ?? t("status.connected");
  return ts.connState === "connecting" ? t("status.connecting") : t("status.notConnected");
});
</script>

<template>
  <header class="top glass-host">
    <span class="dot" :class="{ on: connected, busy: ts.connState === 'connecting' }"></span>
    <div class="who">
      <span class="nick">{{ nickname }}</span>
      <span v-if="ts.selfChannel" class="chan">{{ ts.selfChannel.name }}</span>
    </div>
    <span
      v-if="ts.latencyMs !== null && ts.hubState === 'open'"
      class="ping"
      :class="{ slow: ts.latencyMs > 200 }"
      :title="t('status.latency')"
      >{{ ts.latencyMs }} ms</span
    >
    <button class="more" :title="t('mobile.more')" @click="$emit('open-menu')">⋯</button>
  </header>
</template>

<style scoped>
.top {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  /* `viewport-fit=cover` (index.html) puts the bar under the notch and the
     rounded corners; the insets give the content back the room it needs. In
     landscape the notch is at one side, which is where `⋯` lives. */
  padding-top: calc(6px + env(safe-area-inset-top, 0px));
  padding-left: calc(8px + env(safe-area-inset-left, 0px));
  padding-right: calc(8px + env(safe-area-inset-right, 0px));
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-dim);
}
.dot.on {
  background: var(--ok);
}
.dot.busy {
  background: var(--warn);
}
.who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}
.nick {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chan {
  font-size: 11px;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ping {
  flex: none;
  font-size: 11px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.ping.slow {
  color: var(--warn);
}
.more {
  flex: none;
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  border: none;
  background: transparent;
  font-size: 20px;
  line-height: 1;
  color: var(--text-dim);
}
</style>
