<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useContextMenu } from "../stores/contextMenu";
import { clampToViewport } from "../stores/contextMenuGeometry";
import { useViewport } from "../mobile/useViewport";

const menu = useContextMenu();
/**
 * On a phone the menu is opened by a long press rather than a right click, and
 * a finger has no cursor to anchor to: it rises from the bottom edge as a sheet
 * instead, full width and with rows big enough to hit.
 */
const { isMobile } = useViewport();
const el = ref<HTMLElement | null>(null);
/** Final on-screen position, measured from the rendered menu rather than guessed. */
const pos = ref({ x: 0, y: 0 });

function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape") menu.close();
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));

watch(
  () => [menu.open, menu.x, menu.y, menu.items.length] as const,
  async ([open]) => {
    // The sheet is positioned by CSS; there is nothing to clamp.
    if (!open || isMobile.value) return;
    pos.value = { x: menu.x, y: menu.y };
    await nextTick();
    const rect = el.value?.getBoundingClientRect();
    if (!rect) return;
    pos.value = clampToViewport(
      { x: menu.x, y: menu.y },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
    );
  },
);
</script>

<template>
  <teleport to="body">
    <div
      v-if="menu.open"
      class="cm-overlay"
      :class="{ mobile: isMobile }"
      @click="menu.close()"
      @contextmenu.prevent="menu.close()"
    >
      <div
        ref="el"
        class="cm glass"
        :style="isMobile ? undefined : { left: `${pos.x}px`, top: `${pos.y}px` }"
        @click.stop
      >
        <div v-if="menu.title" class="cm-title">{{ menu.title }}</div>
        <template v-for="(it, i) in menu.items" :key="i">
          <div v-if="it.separator" class="cm-sep"></div>
          <button
            v-else
            class="cm-item"
            :class="{ danger: it.danger, disabled: it.disabled }"
            :data-testid="it.testId"
            :disabled="it.disabled"
            @click="menu.run(it)"
          >
            <span class="cm-icon">{{ it.icon ?? "" }}</span>
            <span class="cm-label">{{ it.label }}</span>
          </button>
        </template>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.cm-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
}
.cm {
  position: fixed;
  min-width: 200px;
  max-width: 260px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 5px;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.55);
  user-select: none;
}
.cm-title {
  padding: 6px 10px 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cm-sep {
  height: 1px;
  background: var(--border);
  margin: 4px 6px;
}
.cm-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 7px 10px;
  color: var(--text);
  font-size: 13px;
}
.cm-item:hover:not(.disabled) {
  background: var(--bg-elev-2);
}
.cm-item.danger {
  color: var(--danger);
}
.cm-item.disabled {
  opacity: 0.45;
}
.cm-icon {
  width: 16px;
  text-align: center;
  flex: none;
}
.cm-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* ------------------------------ mobile sheet ------------------------------ */

.cm-overlay.mobile {
  display: flex;
  align-items: flex-end;
  background: rgba(0, 0, 0, 0.5);
}
.cm-overlay.mobile .cm {
  position: relative;
  width: 100%;
  max-width: none;
  border-radius: 16px 16px 0 0;
  padding: 8px 8px calc(12px + env(safe-area-inset-bottom, 0px));
}
.cm-overlay.mobile .cm-title {
  padding: 10px 12px 8px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 4px;
}
.cm-overlay.mobile .cm-item {
  min-height: 48px;
  font-size: 15px;
  padding: 10px 12px;
}
.cm-overlay.mobile .cm-icon {
  width: 22px;
  font-size: 16px;
}
</style>
