<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useTsStore } from "../stores/ts";
import { locale, useI18n } from "../i18n";

const ts = useTsStore();
const { t } = useI18n();
const verbose = computed({
  get: () => ts.logVerbose,
  set: (v: boolean) => ts.setLogVerbose(v),
});
const scroller = ref<HTMLElement | null>(null);
const stick = ref(true);

const visible = computed(() =>
  verbose.value ? ts.logs : ts.logs.filter((l) => l.level !== "debug"),
);

function fmt(at: number): string {
  const d = new Date(at);
  return (
    d.toLocaleTimeString(locale.value, { hour12: false }) +
    "." +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

function onScroll(): void {
  const el = scroller.value;
  if (!el) return;
  stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

watch(
  () => visible.value.length,
  async () => {
    if (!stick.value) return;
    await nextTick();
    const el = scroller.value;
    if (el) el.scrollTop = el.scrollHeight;
  },
);

function copyAll(): void {
  const text = ts.logs.map((l) => `${fmt(l.at)} [${l.level}] ${l.scope}: ${l.message}`).join("\n");
  void navigator.clipboard?.writeText(text);
}
</script>

<template>
  <div class="log-panel">
    <header class="bar">
      <span class="title">{{ t("log.title") }}</span>
      <label class="chk">
        <input v-model="verbose" type="checkbox" />
        {{ t("log.verbose") }}
      </label>
      <span class="spacer"></span>
      <button class="mini" :title="t('log.copyTitle')" @click="copyAll">
        {{ t("log.copy") }}
      </button>
      <button class="mini" :title="t('log.clearTitle')" @click="ts.clearLogs()">
        {{ t("log.clear") }}
      </button>
      <button class="mini" :title="t('log.close')" @click="ts.showLog = false">✕</button>
    </header>
    <div ref="scroller" class="log" @scroll="onScroll">
      <p v-if="visible.length === 0" class="empty">{{ t("log.empty") }}</p>
      <div v-for="l in visible" :key="l.id" class="line" :class="l.level">
        <span class="time">{{ fmt(l.at) }}</span>
        <span class="scope">{{ l.scope }}</span>
        <span class="msg">{{ l.message }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg);
  border-top: 1px solid var(--border);
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
}
.title {
  font-weight: 600;
  font-size: 12px;
}
.chk {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.chk input {
  width: auto;
}
.spacer {
  flex: 1;
}
.mini {
  padding: 2px 8px;
  font-size: 12px;
}
.log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 10px;
  font-family: "Cascadia Code", "Consolas", ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.55;
}
.empty {
  color: var(--text-dim);
  margin: 4px 0;
}
.line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.time {
  color: var(--text-dim);
  flex: none;
  font-variant-numeric: tabular-nums;
}
.scope {
  color: var(--accent-2);
  flex: none;
  min-width: 64px;
}
.msg {
  flex: 1;
}
.line.debug {
  color: var(--text-dim);
}
.line.info .msg {
  color: var(--text);
}
.line.warn .msg {
  color: var(--warn);
}
.line.error .msg {
  color: var(--danger);
}
</style>
