<script setup lang="ts">
/**
 * Bottom sheet: the mobile stand-in for the desktop's popovers and floating
 * panels. Slides up from the bottom edge, is dismissed by the backdrop, the
 * close button or Escape, and never grows past 85% of the viewport so the
 * backdrop stays tappable.
 */
import { onMounted, onUnmounted } from "vue";
import { useI18n } from "../i18n";

defineProps<{ title: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") emit("close");
}

onMounted(() => document.addEventListener("keydown", onKey));
onUnmounted(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- On <body>: a glass bar that opens a sheet would otherwise trap it in its own stacking context. -->
  <teleport to="body">
    <div class="backdrop" @click.self="emit('close')">
      <section class="sheet glass" role="dialog" aria-modal="true" :aria-label="title">
        <header class="head">
          <span class="grip" aria-hidden="true"></span>
          <h3>{{ title }}</h3>
          <button class="close" :title="t('mobile.close')" @click="emit('close')">×</button>
        </header>
        <div class="body">
          <slot></slot>
        </div>
      </section>
    </div>
  </teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
}
.sheet {
  width: 100%;
  /* `dvh`, not `vh`: on a phone `vh` is measured against the *largest* viewport,
     the one with the address bar hidden, so 85vh of a scrolled-up Safari is
     taller than the screen and the backdrop above it stops being tappable. */
  max-height: 85vh;
  max-height: 85dvh;
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border-top: 1px solid var(--border);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.55);
  /* Clear of the home indicator on a gesture-navigation phone, and of the
     rounded corners at either side when it is held in landscape. */
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
}
.head {
  position: relative;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 12px 8px;
  border-bottom: 1px solid var(--border);
}
.grip {
  position: absolute;
  top: 6px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: var(--border);
}
h3 {
  flex: 1;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.close {
  flex: none;
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  min-width: var(--touch-target);
  min-height: var(--touch-target);
  padding: 4px 12px;
  color: var(--text-dim);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
</style>
