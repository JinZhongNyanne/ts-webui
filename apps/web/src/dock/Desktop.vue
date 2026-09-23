<script setup lang="ts">
import { computed, onMounted, ref, type CSSProperties } from "vue";
import { useI18n } from "../i18n";
import type { MessageKey } from "../i18n/zh-CN";
import { useContextMenu, type MenuItem } from "../stores/contextMenu";
import DesktopIcon from "./DesktopIcon.vue";
import { useWallpaperStore } from "./useWallpaper";
import {
  WALLPAPER_FITS,
  WALLPAPER_MAX_BYTES,
  WALLPAPER_TYPES,
  type WallpaperError,
  type WallpaperFit,
} from "./wallpaper";
import type { WindowId } from "./windowMeta";

/**
 * The desktop: dockview's watermark slot, which it renders whenever the grid
 * holds no panels — permanently, here, because nothing ever docks into it.
 * Icons therefore sit below the floating windows in dockview's own layering.
 *
 * dockview hands watermark components a `params` prop; the desktop is driven
 * by its own props, so `inheritAttrs` is off to keep it off the DOM.
 */
defineOptions({ inheritAttrs: false });
defineProps<{ icons: readonly WindowId[] }>();
const emit = defineEmits<{ open: [id: WindowId] }>();
const { t } = useI18n();
const ctx = useContextMenu();
const wallpaper = useWallpaperStore();
const picker = ref<HTMLInputElement | null>(null);

onMounted(() => void wallpaper.load());

/** i18n key per refusal, as the soundboard and the sticker picker do it. */
const ERRORS: Record<WallpaperError, MessageKey> = {
  empty: "wallpaper.errEmpty",
  "too-large": "wallpaper.errTooLarge",
  "bad-type": "wallpaper.errBadType",
  decode: "wallpaper.errDecode",
  storage: "wallpaper.errStorage",
};

const FIT_LABELS: Record<WallpaperFit, MessageKey> = {
  fill: "wallpaper.fill",
  fit: "wallpaper.fit",
  stretch: "wallpaper.stretch",
  tile: "wallpaper.tile",
  center: "wallpaper.center",
};

/**
 * Vue types an inline `:style` as `CSSProperties`, which carries an index
 * signature for custom properties that a closed object type cannot satisfy;
 * the properties themselves are exactly the ones `CSSProperties` declares.
 */
const wallpaperCss = computed<CSSProperties | undefined>(() =>
  wallpaper.style ? { ...wallpaper.style } : undefined,
);

function wallpaperItems(): MenuItem[] {
  return [
    {
      label: t("wallpaper.choose"),
      icon: "🖼️",
      testId: "desktop-wallpaper-choose",
      action: () => {
        wallpaper.dismissError();
        picker.value?.click();
      },
    },
    { separator: true },
    ...WALLPAPER_FITS.map((fit): MenuItem => ({
      label: t(FIT_LABELS[fit]),
      // The tick marks the fit in force, the way a radio group reads in a
      // native menu; the others keep the slot so the labels stay aligned.
      icon: wallpaper.fit === fit ? "✓" : " ",
      testId: `desktop-wallpaper-fit-${fit}`,
      action: () => wallpaper.setFit(fit),
    })),
    { separator: true },
    {
      label: t("wallpaper.remove"),
      icon: "🚫",
      danger: true,
      disabled: !wallpaper.url,
      testId: "desktop-wallpaper-remove",
      action: () => void wallpaper.clear(),
    },
  ];
}

/**
 * The desktop's own menu, and only on the empty desktop.
 *
 * A right click on an icon bubbles up to here, so the icon is excluded by
 * name — its own menu, if it ever grows one, is the icon's business. Floating
 * windows need no such guard: dockview renders them in overlays beside the
 * watermark rather than inside it, so their events never reach this handler at
 * all (the e2e spec pins that, rather than trusting it).
 */
function onContextMenu(ev: MouseEvent): void {
  const target = ev.target;
  if (target instanceof Element && target.closest("[data-testid=desktop-icon]")) return;
  ctx.show(ev, wallpaperItems(), t("wallpaper.title"));
}

function onPick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  // Clearing the input lets the same file be picked again after a refusal.
  input.value = "";
  if (file) void wallpaper.choose(file);
}
</script>

<template>
  <div
    class="desktop"
    data-testid="desktop"
    role="group"
    :aria-label="t('desktop.label')"
    @contextmenu="onContextMenu"
  >
    <!--
      The picture is its own layer rather than a background on `.desktop`: the
      theme skins paint their gradient there, and layering over it means a
      letterboxed "Fit" or a small "Centre" still shows the theme around the
      edges instead of a bare box.
    -->
    <div
      v-if="wallpaper.style"
      class="desktop-wallpaper"
      data-testid="desktop-wallpaper"
      :style="wallpaperCss"
    ></div>
    <div class="icons">
      <DesktopIcon v-for="id in icons" :key="id" :id="id" @open="emit('open', $event)" />
    </div>
    <p
      v-if="wallpaper.error"
      class="wallpaper-notice"
      role="status"
      data-testid="desktop-wallpaper-error"
      @click="wallpaper.dismissError()"
    >
      {{ t(ERRORS[wallpaper.error], { max: String(Math.floor(WALLPAPER_MAX_BYTES / 1048576)) }) }}
    </p>
    <input
      ref="picker"
      class="wallpaper-file"
      type="file"
      :accept="WALLPAPER_TYPES.join(',')"
      data-testid="desktop-wallpaper-file"
      @change="onPick"
    />
  </div>
</template>
