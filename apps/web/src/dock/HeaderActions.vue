<script setup lang="ts">
import { computed } from "vue";
import type { DockviewApi, DockviewGroupPanel } from "dockview-vue";
import { useI18n } from "../i18n";
import { anyMaximized } from "./maximizedWindows";

/**
 * A window's controls, in the right-hand header actions dockview gives every
 * group: minimise, maximise / restore, close — the Windows three.
 *
 * dockview constructs this component itself, so its buttons cannot be bound to
 * a parent's handlers. Close is the group's own api; minimise and maximise are
 * plain buttons that `App.vue` picks up by delegation from the dock element,
 * because only the desktop knows a floating window's state.
 */
const props = defineProps<{
  params: { containerApi: DockviewApi; group: DockviewGroupPanel; isGroupActive: boolean };
}>();

const { t } = useI18n();

/**
 * Whether *this* window is maximised, which decides the middle button's glyph
 * and its label.
 *
 * dockview builds this component, so the desktop cannot pass its state in as a
 * prop; it publishes it instead and the window reads its own entry — see
 * `maximizedWindows.ts`. The group's panels are read inside the computed so a
 * published change re-reads them, `group.panels` itself not being reactive.
 */
const maximized = computed(() => anyMaximized(props.params.group?.panels?.map((p) => p.id) ?? []));

/**
 * Windows' "restore down" mark — two overlapping squares — against the single
 * square of maximise. A plain text glyph like the other three controls, not an
 * emoji: the emoji forms of these marks come out as coloured blobs beside the
 * flat `—` / `□` / `✕`.
 */
const MAXIMIZE = "□";
const RESTORE = "❐";

/** Closes every tab in this window at once; the desktop icon brings it back. */
function closeGroup(): void {
  props.params.group?.api.close();
}
</script>

<template>
  <div class="hdr-actions">
    <button
      class="hdr-btn"
      :title="t('dock.minimize')"
      :aria-label="t('dock.minimize')"
      data-testid="dock-minimize"
    >
      —
    </button>
    <button
      class="hdr-btn"
      :title="maximized ? t('dock.restore') : t('dock.maximize')"
      :aria-label="maximized ? t('dock.restore') : t('dock.maximize')"
      data-testid="dock-maximize"
    >
      {{ maximized ? RESTORE : MAXIMIZE }}
    </button>
    <button
      class="hdr-btn"
      :title="t('dock.closeGroup')"
      :aria-label="t('dock.closeGroup')"
      data-testid="dock-close-group"
      @click="closeGroup"
    >
      ✕
    </button>
  </div>
</template>

<style scoped>
.hdr-actions {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 6px;
}
.hdr-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 6px;
}
.hdr-btn:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.hdr-btn[data-testid="dock-close-group"]:hover {
  color: var(--danger);
}
</style>
