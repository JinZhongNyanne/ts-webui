<script setup lang="ts">
/**
 * The clip-volume control on a tile: a button showing the shared percent, and a
 * popover with a slider and a value box that are two views of one number.
 *
 * It lives in a popover rather than inline on the tile because the tile itself
 * plays the clip and is dragged around, so a sliver of a slider next to the play
 * button was both hard to hit and easy to mistake for a click. The shared value
 * stays the single truth: the draft is only this user's pending edit, and after
 * every save — refused or not — the display goes back to whatever the hub says,
 * so a rejected change rolls back and someone else's change is never hidden.
 */
import { nextTick, ref, watch } from "vue";
import { useI18n } from "../../i18n";
import { usePopover } from "../../composables/usePopover";
import {
  CLIP_VOLUME_DEFAULT,
  CLIP_VOLUME_MAX,
  CLIP_VOLUME_MIN,
  CLIP_VOLUME_STEP,
  draftFromSlider,
  draftFromText,
  settleDraft,
  shouldCommitVolume,
  volumeDraft,
} from "./clipVolume";

const props = defineProps<{
  /** Clip name, for the popover's label. */
  name: string;
  /** The shared volume in percent; the only truth. */
  volume: number;
  /** Saves a new percent for everyone; false when the hub refused it. */
  commit: (value: number) => Promise<boolean>;
}>();
const { t } = useI18n();

/** Longest a percent can be, so the box cannot hold an essay. */
const MAX_TEXT_LENGTH = String(CLIP_VOLUME_MAX).length + 1;

const root = ref<HTMLElement | null>(null);
const box = ref<HTMLInputElement | null>(null);
const { open, close, panel, style } = usePopover(root);

const draft = ref(volumeDraft(props.volume));
const saving = ref(false);
const failed = ref(false);
/** True while this user has the slider or the box in hand. */
const editing = ref(false);

/**
 * A change from the hub (anyone may re-level a clip) takes over the display,
 * except while this user is mid-edit or mid-save: those two settle themselves
 * and re-read the shared value when they finish.
 */
watch(
  () => props.volume,
  (volume) => {
    if (!editing.value && !saving.value) draft.value = volumeDraft(volume);
  },
);

watch(open, async (isOpen) => {
  if (!isOpen) {
    // Closing saves what is in hand: a press outside takes the popover off the
    // page, and a removed input cannot be relied on to blur first.
    editing.value = false;
    await save();
    return;
  }
  // Each opening starts from the shared value, not from an abandoned edit.
  draft.value = volumeDraft(props.volume);
  failed.value = false;
  await nextTick();
  box.value?.select();
});

function toggle(): void {
  if (open.value) close();
  else open.value = true;
}

/** Sends the draft if it is worth sending, then shows the shared value again. */
async function save(): Promise<void> {
  editing.value = false;
  const next = settleDraft(draft.value);
  draft.value = next;
  if (!shouldCommitVolume(next, props.volume)) return;
  saving.value = true;
  failed.value = false;
  try {
    failed.value = !(await props.commit(next.value));
  } finally {
    saving.value = false;
    draft.value = volumeDraft(props.volume);
  }
}

function onSlider(ev: Event): void {
  const target = ev.target;
  if (!(target instanceof HTMLInputElement)) return;
  editing.value = true;
  draft.value = draftFromSlider(target.value);
}

function onText(ev: Event): void {
  const target = ev.target;
  if (!(target instanceof HTMLInputElement)) return;
  editing.value = true;
  failed.value = false;
  draft.value = draftFromText(draft.value, target.value);
}

/** Escape abandons the edit rather than saving it. */
function abandon(): void {
  draft.value = volumeDraft(props.volume);
  editing.value = false;
  close();
}

function reset(): void {
  draft.value = volumeDraft(CLIP_VOLUME_DEFAULT);
  void save();
}
</script>

<template>
  <div ref="root" class="wrap">
    <button
      type="button"
      class="icon"
      :class="{ active: open }"
      :title="t('sound.volumeOpen', { n: volume })"
      :aria-label="t('sound.volumeOpen', { n: volume })"
      aria-haspopup="dialog"
      :aria-expanded="open"
      data-testid="sound-volume-open"
      @click="toggle"
    >
      🔊 {{ volume }}%
    </button>

    <!-- Teleported to the page: the tiles sit in a scrolling grid inside a dock
         window, which would cut a popover off at its edge. `usePopover` pins it
         to the button above and still counts presses in it as inside. -->
    <teleport to="body">
      <div
        v-if="open"
        ref="panel"
        class="popover"
        role="dialog"
        :aria-label="t('sound.volumePanel', { name })"
        data-testid="sound-volume-popover"
        :style="style"
      >
        <div class="head">
          <span class="title">{{ t("sound.volumePanel", { name }) }}</span>
          <input
            ref="box"
            class="box"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            :maxlength="MAX_TEXT_LENGTH"
            :value="draft.text"
            :aria-label="t('sound.volumeValue')"
            :aria-invalid="draft.invalid"
            :disabled="saving"
            data-testid="sound-volume-value"
            @input="onText"
            @keydown.enter.prevent="save"
            @keydown.esc.prevent="abandon"
            @blur="save"
          />
        </div>
        <input
          class="slider"
          type="range"
          :min="CLIP_VOLUME_MIN"
          :max="CLIP_VOLUME_MAX"
          :step="CLIP_VOLUME_STEP"
          :value="draft.value"
          :title="t('sound.volume', { n: draft.value })"
          :aria-label="t('sound.volume', { n: draft.value })"
          :disabled="saving"
          data-testid="sound-volume"
          @input="onSlider"
          @change="save"
        />
        <div class="foot">
          <p v-if="draft.invalid" class="msg warn" role="alert">
            {{ t("sound.volumeInvalid", { max: CLIP_VOLUME_MAX }) }}
          </p>
          <p v-else-if="failed" class="msg error" role="alert" data-testid="sound-volume-failed">
            {{ t("sound.volumeFailed", { n: volume }) }}
          </p>
          <button
            type="button"
            class="reset"
            :disabled="saving || draft.value === CLIP_VOLUME_DEFAULT"
            data-testid="sound-volume-reset"
            @click="reset"
          >
            {{ t("sound.volumeReset", { n: CLIP_VOLUME_DEFAULT }) }}
          </button>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
}
.icon {
  flex: 1;
  min-width: 0;
  padding: 2px 5px;
  border: none;
  background: transparent;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
}
.icon:hover,
.icon.active {
  color: var(--text);
}
/* Placed by `usePopover`: fixed, on the popover layer, anchored on the button. */
.popover {
  width: 200px;
  max-width: var(--popover-max-width, 100vw);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  font-size: 11px;
  color: var(--text-dim);
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.box {
  flex: none;
  width: 52px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.box[aria-invalid="true"] {
  border-color: var(--warn);
}
.slider {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
}
.foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
.msg {
  flex: 1;
  margin: 0;
  font-size: 10px;
}
.msg.warn {
  color: var(--warn);
}
.msg.error {
  color: var(--danger);
}
.reset {
  margin-left: auto;
  padding: 3px 8px;
  font-size: 11px;
}
</style>
