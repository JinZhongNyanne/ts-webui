<script setup lang="ts">
import { useI18n } from "../i18n";
import { setSnapToEdges, setSnapToWindows, snapToEdges, snapToWindows } from "./snapMode";
import type { TaskbarButton } from "./taskbar";

/**
 * The taskbar: one button per open window, the way Windows does it. A closed
 * window has no button — its desktop icon opens it again.
 *
 * At the far right, pinned there the way Windows pins "show desktop", sit the
 * bar's own affordances: the two snap switches and the minimise-all toggle.
 * Only the window buttons scroll: they live in their own overflow container, so
 * a taskbar full of windows never pushes those out of reach.
 *
 * The two snaps get a switch each rather than one control opening a popover.
 * They are two independent booleans, so a popover would put a click and a
 * dismissal in front of flipping either, and these are icon-only buttons in the
 * pinned group's tight padding: three of them take less room than the shortest
 * window button, and the group is pushed to the end by a named class rather than
 * by source order, so it cannot crowd the list.
 *
 * Both switches are wired straight to `snapMode.ts` rather than emitted like the
 * window actions above them. Those act on windows, which only `App.vue` can
 * reach; a snap rule is a preference the drag hook reads from that same
 * module-level singleton, so routing it through the shell would add a prop and
 * an event that carry nothing.
 */
defineProps<{ buttons: readonly TaskbarButton[] }>();
const emit = defineEmits<{
  activate: [button: TaskbarButton];
  close: [panelId: string];
  minimizeAll: [];
}>();
const { t } = useI18n();
</script>

<template>
  <nav class="window-bar glass-host" :aria-label="t('dock.windows')">
    <div class="task-list">
      <button
        v-for="button in buttons"
        :key="button.panelId"
        class="task-btn"
        :class="{ active: button.active, minimized: button.minimized }"
        :aria-pressed="button.active"
        data-testid="taskbar-button"
        :data-panel="button.panelId"
        :title="t('dock.showWindow', { name: button.title })"
        @click="emit('activate', button)"
        @contextmenu.prevent="emit('close', button.panelId)"
      >
        <span class="task-icon" aria-hidden="true">{{ button.icon }}</span>
        <span class="task-label">{{ button.title }}</span>
      </button>
    </div>
    <button
      class="task-btn snap-mode pinned pin-start"
      :class="{ active: snapToEdges() }"
      type="button"
      role="switch"
      :aria-checked="snapToEdges()"
      data-testid="taskbar-snap-edges"
      :title="t('dock.snapToEdges')"
      :aria-label="t('dock.snapToEdges')"
      @click="setSnapToEdges(!snapToEdges())"
    >
      <span class="task-icon" aria-hidden="true">⊞</span>
    </button>
    <button
      class="task-btn snap-mode pinned"
      :class="{ active: snapToWindows() }"
      type="button"
      role="switch"
      :aria-checked="snapToWindows()"
      data-testid="taskbar-snap-windows"
      :title="t('dock.snapToWindows')"
      :aria-label="t('dock.snapToWindows')"
      @click="setSnapToWindows(!snapToWindows())"
    >
      <span class="task-icon" aria-hidden="true">⧉</span>
    </button>
    <button
      class="task-btn show-desktop pinned"
      type="button"
      data-testid="taskbar-minimize-all"
      :title="t('dock.minimizeAll')"
      :aria-label="t('dock.minimizeAll')"
      @click="emit('minimizeAll')"
    >
      <span class="task-icon" aria-hidden="true">▁</span>
    </button>
  </nav>
</template>
