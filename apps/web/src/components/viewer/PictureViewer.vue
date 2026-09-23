<script setup lang="ts">
/**
 * The picture viewer: one picture, filling the screen, that can be magnified,
 * shrunk and dragged around — what a click on a picture in chat opens instead
 * of downloading it (`chat/richClick.ts`).
 *
 * All the arithmetic is in `zoom.ts`; this file is the events and the chrome.
 *
 * ## Above the desktop, not inside it
 *
 * The app is a desktop of dockview windows, and `.dock-wrap` in App.vue both
 * isolates its stacking context and clips what hangs outside it, so a viewer
 * rendered inside the chat panel would be cut off at the window's edge. It is
 * therefore teleported to `<body>`, like every dialog (`ui/AppDialog.vue`), and
 * takes the next step of the app's existing scale: popovers 20, mobile sheets
 * 60, dialogs 70, this 80, the context menu 1000. Above the dialogs because a
 * picture can be opened from one; below the context menu because that menu is
 * the one thing that must always be reachable on top.
 *
 * ## Gestures
 *
 * Pointer events throughout, so a mouse, a pen and fingers are one code path:
 * one pointer down drags (only when there is something to drag), two pinch
 * around their midpoint. `touch-action: none` on the stage is what makes a
 * phone hand the gesture over instead of scrolling the page, and the wheel
 * listener calls `preventDefault` for the same reason — with the overlay
 * covering everything, nothing underneath was going to be scrolled anyway.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "../../i18n";
import { modalStack, trapTab } from "../ui/focus-trap";
import { isDoubleTap, isTap } from "./tapGesture";
import {
  WHEEL_ZOOM_STEP,
  ZOOM_STEP,
  actualView,
  canPan,
  fitView,
  isActual,
  isFit,
  panView,
  pinchFactor,
  toggleFitActual,
  viewOf,
  zoomAtCentre,
  zoomPercent,
  zoomView,
  type PictureView,
} from "./zoom";

const props = defineProps<{ url: string; name: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
/**
 * The viewer takes its turn in the app's modal stack, so a dialog underneath it
 * does not also close on the Escape that closes the viewer, and Tab stays in
 * the toolbar instead of wandering into the desktop behind (ui/focus-trap.ts).
 *
 * An open popover needs no such arrangement: the press that opened the viewer
 * landed outside every popover, which is exactly what the popover registry
 * (composables/popover-core.ts) already dismisses them on.
 */
const stackId = Symbol("pictureViewer");

const stage = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
/** Null until the picture has decoded; the toolbar is quiet until then. */
const view = ref<PictureView | null>(null);
const failed = ref(false);

/** Live pointers on the stage, by id: one pans, two pinch. */
const pointers = new Map<number, { x: number; y: number }>();
let pinchStart: { distance: number; scale: number } | null = null;
/**
 * The lone finger that might still turn out to be a tap, remembered where it
 * went down. It has to be kept apart from `pointers`, which is overwritten on
 * every move: measuring the slop against the latest position would find no
 * movement at all and call every drag a tap.
 */
let press: { x: number; y: number } | null = null;
/** A second finger joined this gesture, so no release in it is a tap. */
let multiTouch = false;
let lastTapAt = 0;
/** Whether the gesture in hand is a finger's; see `onDoubleClick`. */
let touching = false;

const percent = computed(() => (view.value ? zoomPercent(view.value) : 100));
const fitted = computed(() => !!view.value && isFit(view.value));
const actual = computed(() => !!view.value && isActual(view.value));
const draggable = computed(() => !!view.value && canPan(view.value));

/** Where the picture is drawn: a plain transform, so nothing re-layouts. */
const pictureStyle = computed(() => {
  const v = view.value;
  if (!v) return { visibility: "hidden" as const };
  return {
    width: `${v.imgW}px`,
    height: `${v.imgH}px`,
    transform: `translate(${v.x}px, ${v.y}px) scale(${v.scale})`,
  };
});

function stageSize(): { width: number; height: number } {
  const box = stage.value?.getBoundingClientRect();
  // Before the first frame the stage has no box; the viewport is the honest
  // fallback, and the resize observer corrects it a tick later.
  return { width: box?.width || window.innerWidth, height: box?.height || window.innerHeight };
}

/** Re-fits to a resized stage (a resized window, a rotated phone), keeping the zoom. */
function remeasure(): void {
  const v = view.value;
  if (!v) return;
  const size = stageSize();
  view.value = viewOf(v.imgW, v.imgH, size.width, size.height, v);
}

function onLoad(ev: Event): void {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement)) return;
  failed.value = false;
  const size = stageSize();
  view.value = fitView(img.naturalWidth, img.naturalHeight, size.width, size.height);
}

/**
 * The address was already on screen in the message, so a failure here means
 * the preview cache has since evicted it (or the host stopped answering). Say
 * so rather than showing an empty box; the message itself still has the card.
 */
function onError(): void {
  failed.value = true;
  view.value = null;
}

function apply(next: PictureView | null): void {
  if (next) view.value = next;
}

function zoom(factor: number): void {
  apply(view.value && zoomAtCentre(view.value, factor));
}

function showFit(): void {
  const v = view.value;
  apply(v && fitView(v.imgW, v.imgH, v.viewW, v.viewH));
}

function showActual(): void {
  apply(view.value && actualView(view.value));
}

function toggle(): void {
  apply(view.value && toggleFitActual(view.value));
}

/* --------------------------------- gestures -------------------------------- */

function stagePoint(ev: PointerEvent | WheelEvent): { x: number; y: number } {
  const box = stage.value?.getBoundingClientRect();
  return { x: ev.clientX - (box?.left ?? 0), y: ev.clientY - (box?.top ?? 0) };
}

function onWheel(ev: WheelEvent): void {
  ev.preventDefault();
  const at = stagePoint(ev);
  const factor = ev.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
  apply(view.value && zoomView(view.value, factor, at.x, at.y));
}

const distanceOf = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

function twoPointers(): [{ x: number; y: number }, { x: number; y: number }] | null {
  const live = [...pointers.values()];
  return live.length === 2 && live[0] && live[1] ? [live[0], live[1]] : null;
}

function onPointerDown(ev: PointerEvent): void {
  // Only the primary button drags: the right one belongs to the browser's menu.
  if (ev.button !== 0) return;
  touching = ev.pointerType === "touch";
  const at = stagePoint(ev);
  pointers.set(ev.pointerId, at);
  if (pointers.size === 1) press = at;
  else {
    // A pinch is under way, so nothing in this gesture is a tap any more.
    press = null;
    multiTouch = true;
  }
  const pair = twoPointers();
  if (pair && view.value) {
    pinchStart = { distance: distanceOf(pair[0], pair[1]), scale: view.value.scale };
  }
  // Captured so a drag that leaves the picture (or the window) still arrives.
  if (ev.currentTarget instanceof Element) ev.currentTarget.setPointerCapture(ev.pointerId);
}

function onPointerMove(ev: PointerEvent): void {
  const previous = pointers.get(ev.pointerId);
  if (!previous || !view.value) return;
  const at = stagePoint(ev);
  pointers.set(ev.pointerId, at);
  // Past the slop this is a drag; it can no longer end in a tap.
  if (press && !isTap(press, at)) press = null;
  const pair = twoPointers();
  if (pair && pinchStart) {
    const factor = pinchFactor(pinchStart.distance, distanceOf(pair[0], pair[1]));
    const mid = { x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 };
    // Against the scale the pinch started at, so the gesture cannot drift.
    apply(zoomView(view.value, (pinchStart.scale * factor) / view.value.scale, mid.x, mid.y));
    return;
  }
  if (pointers.size === 1) apply(panView(view.value, at.x - previous.x, at.y - previous.y));
}

/**
 * A phone may get no `dblclick` while `touch-action` is none, so tapping twice
 * is recognised here. Only a release that ends the whole gesture can be a tap:
 * lifting the first of two pinching fingers used to count as one, and the pair
 * of releases at the end of a pinch then read as a double tap that threw the
 * magnification away the instant the fingers left the glass.
 */
function onPointerUp(ev: PointerEvent): void {
  const tap = press;
  press = null;
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchStart = null;
  // Fingers still down: whatever this was, the gesture is not over.
  if (pointers.size > 0) {
    multiTouch = true;
    return;
  }
  const pinched = multiTouch;
  multiTouch = false;
  // Only a tap keeps a pending double tap alive; a drag ends the chain.
  if (ev.pointerType !== "touch" || pinched || !tap) {
    lastTapAt = 0;
    return;
  }
  if (isDoubleTap(lastTapAt, ev.timeStamp)) {
    toggle();
    lastTapAt = 0;
  } else lastTapAt = ev.timeStamp;
}

/**
 * The mouse's and the pen's double click. A phone is deliberately left out:
 * Chromium on Android synthesises a `dblclick` for a double tap *as well as*
 * delivering the pointer events above, and toggling twice for one gesture put
 * the picture back exactly where it started — the double tap looked dead.
 */
function onDoubleClick(): void {
  if (touching) return;
  toggle();
}

function onPointerCancel(ev: PointerEvent): void {
  pointers.delete(ev.pointerId);
  if (pointers.size < 2) pinchStart = null;
  press = null;
  lastTapAt = 0;
  if (pointers.size === 0) multiTouch = false;
}

/* ------------------------------- the keyboard ------------------------------ */

function onKey(ev: KeyboardEvent): void {
  if (!modalStack.isTop(stackId)) return;
  if (ev.key === "Tab") {
    if (panel.value) trapTab(panel.value, ev);
    return;
  }
  if (ev.key === "Escape") {
    ev.stopPropagation();
    emit("close");
  } else if (ev.key === "+" || ev.key === "=") zoom(ZOOM_STEP);
  else if (ev.key === "-") zoom(1 / ZOOM_STEP);
  else if (ev.key === "0") showFit();
  else if (ev.key === "1") showActual();
  else return;
  ev.preventDefault();
}

/** A press that started on the backdrop itself closes; a drag that ended there does not. */
let pressOnBackdrop = false;

function onBackdropDown(ev: PointerEvent): void {
  pressOnBackdrop = ev.target === ev.currentTarget;
}

function onBackdropClick(ev: MouseEvent): void {
  if (pressOnBackdrop && ev.target === ev.currentTarget) emit("close");
  pressOnBackdrop = false;
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  modalStack.push(stackId);
  document.addEventListener("keydown", onKey);
  // So the arrow-free keyboard shortcuts above work without a click first.
  panel.value?.focus();
  if (typeof ResizeObserver === "function" && stage.value) {
    observer = new ResizeObserver(remeasure);
    observer.observe(stage.value);
  }
});

onBeforeUnmount(() => {
  modalStack.remove(stackId);
  document.removeEventListener("keydown", onKey);
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <!-- On <body>: the dock window the chat lives in clips and isolates its own box. -->
  <teleport to="body">
    <div class="viewer-backdrop" @pointerdown="onBackdropDown" @click="onBackdropClick">
      <div
        ref="panel"
        class="viewer-panel"
        role="dialog"
        aria-modal="true"
        :aria-label="props.name || t('viewer.title')"
        tabindex="-1"
      >
        <header class="viewer-bar">
          <span v-if="props.name" class="viewer-name" :title="props.name">{{ props.name }}</span>
          <span
            class="viewer-zoom"
            :aria-label="t('viewer.zoomLevel', { percent: String(percent) })"
          >
            {{ percent }}%
          </span>
          <span class="viewer-tools">
            <button
              type="button"
              data-testid="viewer-zoom-out"
              :title="t('viewer.zoomOut')"
              :aria-label="t('viewer.zoomOut')"
              @click="zoom(1 / ZOOM_STEP)"
            >
              −
            </button>
            <button
              type="button"
              data-testid="viewer-zoom-in"
              :title="t('viewer.zoomIn')"
              :aria-label="t('viewer.zoomIn')"
              @click="zoom(ZOOM_STEP)"
            >
              +
            </button>
            <button
              type="button"
              data-testid="viewer-fit"
              :class="{ on: fitted }"
              :aria-pressed="fitted"
              :title="t('viewer.fit')"
              @click="showFit"
            >
              ⤢
            </button>
            <button
              type="button"
              data-testid="viewer-actual"
              :class="{ on: actual }"
              :aria-pressed="actual"
              :title="t('viewer.actual')"
              @click="showActual"
            >
              1:1
            </button>
            <button
              type="button"
              class="viewer-close"
              data-testid="viewer-close"
              :title="t('viewer.close')"
              :aria-label="t('viewer.close')"
              @click="emit('close')"
            >
              ×
            </button>
          </span>
        </header>
        <div
          ref="stage"
          class="viewer-stage"
          :class="{ grab: draggable }"
          @wheel="onWheel"
          @dblclick="onDoubleClick"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
        >
          <p v-if="failed" class="viewer-failed">{{ t("viewer.failed") }}</p>
          <!--
            No referrer, like the message's own copy (ts/bbcode.ts): the page URL
            is nobody else's business, and this `<img>` must be the same request
            the message already made so the browser answers it from its cache
            rather than going back to an external host.
          -->
          <img
            v-else
            class="viewer-img"
            :src="props.url"
            :alt="props.name"
            :style="pictureStyle"
            referrerpolicy="no-referrer"
            draggable="false"
            @load="onLoad"
            @error="onError"
          />
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.viewer-backdrop {
  position: fixed;
  inset: 0;
  /* The app's scale: popovers 20, sheets 60, dialogs 70, this, menu 1000. */
  z-index: 80;
  background: rgb(0 0 0 / 78%);
  display: flex;
}
.viewer-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  outline: none;
}
.viewer-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  /* The overlay covers the whole screen, notch and all (`viewport-fit=cover` in
     index.html), so without these the toolbar — the close button included — is
     drawn underneath the status bar and cannot be reached at all. */
  padding-top: calc(8px + env(safe-area-inset-top, 0px));
  padding-left: calc(10px + env(safe-area-inset-left, 0px));
  padding-right: calc(10px + env(safe-area-inset-right, 0px));
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}
.viewer-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.viewer-zoom {
  flex: none;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.viewer-tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.viewer-tools button {
  min-width: 32px;
  min-height: 32px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  line-height: 1;
}
.viewer-tools button:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.viewer-tools button.on {
  border-color: var(--accent);
  color: var(--accent);
}
.viewer-close {
  font-size: 18px;
}
.viewer-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  overflow: hidden;
  /* The gestures are ours: a phone must not scroll or zoom the page instead. */
  touch-action: none;
}
.viewer-stage.grab {
  cursor: grab;
}
.viewer-img {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  /* Sharp when magnified past 100%: an emoji's pixels are the point. */
  image-rendering: -webkit-optimize-contrast;
  -webkit-user-select: none;
  user-select: none;
}
.viewer-failed {
  margin: 0;
  padding: 24px;
  text-align: center;
  color: var(--text-dim);
}
/* The toolbar is a row of icons a mouse can hit at 32px and a fingertip cannot. */
@media (pointer: coarse) {
  .viewer-tools button {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
  }
}
</style>
