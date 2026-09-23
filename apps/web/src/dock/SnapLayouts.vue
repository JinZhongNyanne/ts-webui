<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../i18n";
import { fractionPercent, SNAP_LAYOUTS, type LayoutArea, type SnapLayoutId } from "./layouts";
import { PANEL_TESTID, TILE_TESTID } from "./snapLayoutTile";
import { PANEL_WIDTH } from "./useSnapLayouts";

/**
 * Windows 11's Snap Layouts flyout: a row of thumbnails, each a miniature of
 * the desktop divided one way, each region of it a button that puts the window
 * there.
 *
 * Two triggers share this one component. With an `anchor` it is the hover
 * flyout, pinned under a window's titlebar; without one it is the panel that
 * drops from the top of the desktop mid-drag, centred on the desktop and low
 * enough that the top edge itself is still clear — releasing *there* is the
 * plain Aero Snap gesture and must keep filling the desktop.
 *
 * The thumbnails are drawn from the same fractions `layouts.ts` snaps by, so
 * what the tile shows is what the window gets.
 */
const props = defineProps<{ anchor: { left: number; top: number } | null }>();
const emit = defineEmits<{
  pick: [layoutId: SnapLayoutId, zoneId: string];
  hold: [];
  release: [];
  close: [];
}>();

const { t } = useI18n();

const layouts = SNAP_LAYOUTS;

const style = computed(() => ({
  width: `${PANEL_WIDTH}px`,
  ...(props.anchor ? { left: `${props.anchor.left}px`, top: `${props.anchor.top}px` } : {}),
}));

/** A region of a thumbnail, as the percentages of the miniature it covers. */
function tileStyle(area: LayoutArea): Record<string, string> {
  const left = fractionPercent(area.left);
  const top = fractionPercent(area.top);
  return {
    left: `${left}%`,
    top: `${top}%`,
    width: `${fractionPercent(area.right) - left}%`,
    height: `${fractionPercent(area.bottom) - top}%`,
  };
}
</script>

<template>
  <div
    class="snap-layouts"
    :class="{ 'from-drag': !anchor }"
    :data-testid="PANEL_TESTID"
    role="group"
    :aria-label="t('dock.snapLayouts')"
    :style="style"
    @mouseenter="emit('hold')"
    @mouseleave="emit('release')"
    @keydown.escape.stop="emit('close')"
  >
    <div v-for="layout in layouts" :key="layout.id" class="snap-layout">
      <button
        v-for="zone in layout.zones"
        :key="zone.id"
        type="button"
        class="snap-layout-zone"
        :data-testid="TILE_TESTID"
        :data-layout="layout.id"
        :data-zone="zone.id"
        :style="tileStyle(zone.area)"
        :title="t('dock.snapHere')"
        :aria-label="t('dock.snapHere')"
        @click="emit('pick', layout.id, zone.id)"
      />
    </div>
  </div>
</template>
