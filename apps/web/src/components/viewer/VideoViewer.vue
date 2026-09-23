<script setup lang="ts">
/**
 * The video player: one clip, filling the screen, with its own transport bar —
 * what a click on a video poster in chat opens (`chat/richClick.ts`).
 *
 * All the arithmetic is in `playback.ts`; this file is the events and the
 * chrome. It is the picture viewer's sibling and shares its overlay decisions
 * on purpose: teleported to `<body>` (the dock window the chat lives in clips
 * and isolates its own box), the same z-index 80 in the app's scale, the same
 * turn in the modal stack so Escape closes this and not the dialog underneath.
 * The slot they share (`media-viewer.ts`) is what keeps them from ever being on
 * screen together.
 *
 * ## Nothing plays by itself
 *
 * There is no `autoplay` anywhere here: the player opens paused on the first
 * frame and the first press is the user's. In a call it also opens muted
 * (`startsMuted` in playback.ts explains why), with the mute button showing
 * that state, so a clip can never talk over a conversation already in progress.
 *
 * ## The source is borrowed
 *
 * `props.url` comes from `chat/files/videos.ts` and is used as it is: either a
 * `blob:` URL of bytes the page already holds, or a same-origin media link the
 * hub streams from (`/api/files/media/…`), which the element reads a range at
 * a time and asks again on every seek. Nothing here chooses between them or
 * fetches anything itself, and neither reaches another host: there is no
 * Referer to leak and no external content to load behind the user's back.
 * `crossorigin="anonymous"` and the absence of any `poster` attribute keep it
 * that way even if a future caller hands this component an `https:` address.
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "../../i18n";
import { useVoiceStore } from "../../stores/voice";
import { modalStack, trapTab } from "../ui/focus-trap";
import { VOLUME_STEP } from "../volume/quickVolume";
import {
  SEEK_STEP_S,
  VIDEO_VOLUME_MAX,
  clampMediaTime,
  clampMediaVolume,
  formatMediaTime,
  mediaVolumePercent,
  seekBy,
  startsMuted,
  stepMediaVolume,
  timeAtFraction,
  timeFraction,
  volumeAfterUnmute,
} from "./playback";

const props = defineProps<{ url: string; name: string }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
/** This player's turn in the app's modal stack (see PictureViewer.vue). */
const stackId = Symbol("videoViewer");
/** The seek slider's resolution: a thousandth of the clip, whatever its length. */
const SEEK_NOTCHES = 1000;

const panel = ref<HTMLElement | null>(null);
const media = ref<HTMLVideoElement | null>(null);

const playing = ref(false);
const muted = ref(false);
const volume = ref(VIDEO_VOLUME_MAX);
const current = ref(0);
const duration = ref(0);
const failed = ref(false);

const fraction = computed(() => timeFraction(current.value, duration.value));
const sliderValue = computed(() => Math.round(fraction.value * SEEK_NOTCHES));
const percent = computed(() => mediaVolumePercent(volume.value));
/** Read out as "0:12 of 1:30", which is what the bar means. */
const clock = computed(() =>
  t("viewer.videoAt", {
    at: formatMediaTime(current.value),
    total: formatMediaTime(duration.value),
  }),
);

/* ------------------------------ the transport ------------------------------ */

function apply(): void {
  const el = media.value;
  if (!el) return;
  el.muted = muted.value;
  el.volume = clampMediaVolume(volume.value);
}

function togglePlay(): void {
  const el = media.value;
  if (!el || failed.value) return;
  if (el.paused) {
    // A rejected play is a browser policy or a broken file, never a crash: the
    // button simply stays on "play" and the user can try again.
    void el.play().catch(() => {
      playing.value = false;
    });
  } else el.pause();
}

function seek(seconds: number): void {
  const el = media.value;
  if (!el) return;
  const to = clampMediaTime(seconds, duration.value);
  el.currentTime = to;
  current.value = to;
}

function seekByStep(deltaS: number): void {
  seek(seekBy(current.value, duration.value, deltaS));
}

function onSliderInput(ev: Event): void {
  const target = ev.target;
  if (!(target instanceof HTMLInputElement)) return;
  seek(timeAtFraction(Number(target.value) / SEEK_NOTCHES, duration.value));
}

function setVolume(next: number): void {
  volume.value = clampMediaVolume(next);
  // Turning the slider up is also how one unmutes: a slider that moves and
  // changes nothing audible is the single most confusing control there is.
  if (volume.value > 0) muted.value = false;
  apply();
}

function onVolumeInput(ev: Event): void {
  const target = ev.target;
  if (!(target instanceof HTMLInputElement)) return;
  setVolume(Number(target.value));
}

function nudgeVolume(notches: number): void {
  setVolume(stepMediaVolume(volume.value, notches));
}

function toggleMuted(): void {
  if (muted.value) {
    muted.value = false;
    volume.value = volumeAfterUnmute(volume.value);
  } else muted.value = true;
  apply();
}

/* ------------------------------ the element ------------------------------- */

function onLoadedMetadata(): void {
  const el = media.value;
  if (!el) return;
  failed.value = false;
  duration.value = el.duration;
  apply();
}

function onTimeUpdate(): void {
  current.value = media.value?.currentTime ?? 0;
}

function onDurationChange(): void {
  duration.value = media.value?.duration ?? 0;
}

/**
 * The address worked a moment ago, so a failure here means the video cache has
 * since dropped its `blob:` URL, the media link has expired or gone with its
 * session, or this browser turned out not to play this file. Say so rather
 * than showing a black box.
 */
function onError(): void {
  failed.value = true;
  playing.value = false;
}

/* ------------------------------- the keyboard ------------------------------ */

/** Whether `el` is a control that wants the key itself (a slider's arrows). */
function ownsKeys(el: EventTarget | null): boolean {
  return el instanceof HTMLInputElement && el.type === "range";
}

function onKey(ev: KeyboardEvent): void {
  if (!modalStack.isTop(stackId)) return;
  if (ev.key === "Tab") {
    if (panel.value) trapTab(panel.value, ev);
    return;
  }
  if (ev.key === "Escape") {
    ev.stopPropagation();
    emit("close");
  } else if (ev.key === " " || ev.key === "Enter") {
    // A press on a focused button is that button's; Space anywhere else in the
    // player is the play/pause every video player in the world has.
    if (ev.target instanceof HTMLButtonElement || ev.target instanceof HTMLInputElement) return;
    togglePlay();
  } else if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
    if (ownsKeys(ev.target)) return;
    seekByStep(ev.key === "ArrowRight" ? SEEK_STEP_S : -SEEK_STEP_S);
  } else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
    if (ownsKeys(ev.target)) return;
    nudgeVolume(ev.key === "ArrowUp" ? 1 : -1);
  } else if (ev.key === "m" || ev.key === "M") {
    toggleMuted();
  } else return;
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

onMounted(() => {
  modalStack.push(stackId);
  document.addEventListener("keydown", onKey);
  // In a call the clip is silent until its mute button says otherwise.
  muted.value = startsMuted(useVoiceStore().engineReady);
  apply();
  // So Space and the arrows work without a click first.
  panel.value?.focus();
});

onBeforeUnmount(() => {
  modalStack.remove(stackId);
  document.removeEventListener("keydown", onKey);
  // Leaving a playing element behind would go on decoding (and, unmuted, go on
  // making noise) for as long as Vue took to collect it. Its source goes too:
  // a media link runs one stream at a time, and a closed player that kept its
  // request open would hold the link's slot until the hub timed it out, and
  // be cut by whatever asked for the link next.
  const el = media.value;
  if (el) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
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
        :aria-label="props.name || t('viewer.videoTitle')"
        tabindex="-1"
      >
        <header class="viewer-bar">
          <span v-if="props.name" class="viewer-name" :title="props.name">{{ props.name }}</span>
          <span class="viewer-tools">
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
        <div class="viewer-stage">
          <p v-if="failed" class="viewer-failed">{{ t("viewer.videoFailed") }}</p>
          <!--
            No autoplay and no poster attribute: it opens paused on its first
            frame, and nothing is ever fetched from anywhere but the address it
            was given (a `blob:` URL, or the hub's own media link).
          -->
          <video
            v-show="!failed"
            ref="media"
            class="viewer-video"
            :src="props.url"
            preload="metadata"
            playsinline
            crossorigin="anonymous"
            @click="togglePlay"
            @loadedmetadata="onLoadedMetadata"
            @durationchange="onDurationChange"
            @timeupdate="onTimeUpdate"
            @play="playing = true"
            @pause="playing = false"
            @ended="playing = false"
            @error="onError"
          ></video>
        </div>
        <footer v-if="!failed" class="viewer-transport">
          <button
            type="button"
            class="viewer-play"
            data-testid="viewer-play"
            :aria-pressed="playing"
            :title="playing ? t('viewer.pause') : t('viewer.play')"
            :aria-label="playing ? t('viewer.pause') : t('viewer.play')"
            @click="togglePlay"
          >
            {{ playing ? "⏸" : "▶" }}
          </button>
          <span class="viewer-clock" aria-hidden="true">
            {{ formatMediaTime(current) }} / {{ formatMediaTime(duration) }}
          </span>
          <input
            class="viewer-seek"
            data-testid="viewer-seek"
            type="range"
            min="0"
            :max="SEEK_NOTCHES"
            step="1"
            :value="sliderValue"
            :aria-label="t('viewer.seek')"
            :aria-valuetext="clock"
            @input="onSliderInput"
          />
          <button
            type="button"
            class="viewer-mute"
            data-testid="viewer-mute"
            :class="{ on: muted }"
            :aria-pressed="muted"
            :title="muted ? t('viewer.unmute') : t('viewer.mute')"
            :aria-label="muted ? t('viewer.unmute') : t('viewer.mute')"
            @click="toggleMuted"
          >
            {{ muted || volume === 0 ? "🔇" : "🔊" }}
          </button>
          <input
            class="viewer-volume"
            data-testid="viewer-volume"
            type="range"
            min="0"
            :max="VIDEO_VOLUME_MAX"
            :step="VOLUME_STEP"
            :value="volume"
            :aria-label="t('viewer.volume')"
            :aria-valuetext="t('viewer.volumeLevel', { percent: String(percent) })"
            @input="onVolumeInput"
          />
          <span class="viewer-percent" aria-hidden="true">{{ percent }}%</span>
        </footer>
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
.viewer-tools {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.viewer-close {
  min-width: 32px;
  min-height: 32px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.viewer-stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.viewer-video {
  max-width: 100%;
  max-height: 100%;
  /* A click on the picture is play/pause, so say so. */
  cursor: pointer;
}
.viewer-transport {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  /* Clear of the home indicator, which a swipe up belongs to, and of the side
     notch in landscape; see `.viewer-bar`. */
  padding-bottom: calc(8px + env(safe-area-inset-bottom, 0px));
  padding-left: calc(12px + env(safe-area-inset-left, 0px));
  padding-right: calc(12px + env(safe-area-inset-right, 0px));
  color: var(--text);
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  border-top: 1px solid var(--border);
  font-size: 12px;
}
.viewer-transport button {
  min-width: 36px;
  min-height: 32px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  line-height: 1;
}
.viewer-transport button:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.viewer-transport button.on {
  border-color: var(--accent);
  color: var(--accent);
}
.viewer-clock,
.viewer-percent {
  flex: none;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.viewer-seek {
  flex: 1;
  min-width: 80px;
}
.viewer-volume {
  flex: none;
  width: 96px;
}
.viewer-failed {
  margin: 0;
  padding: 24px;
  text-align: center;
  color: var(--text-dim);
}
/*
 * The transport is six controls in a row, which wants about 420px; on a 390px
 * phone the volume slider and the percentage were simply cut off the end. The
 * seek slider takes a row of its own above the rest — it is the control that
 * most wants the width, and the one a thumb reaches for first.
 */
@media (max-width: 560px) {
  .viewer-transport {
    flex-wrap: wrap;
    row-gap: 6px;
  }
  .viewer-seek {
    order: -1;
    flex: 1 0 100%;
  }
  .viewer-volume {
    flex: 1;
    width: auto;
    min-width: 0;
  }
}
@media (pointer: coarse) {
  .viewer-close,
  .viewer-transport button {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
  }
}
</style>
