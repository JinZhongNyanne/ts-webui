<script setup lang="ts">
/**
 * The one modal every dialog is built on: title, body slot, footer actions.
 *
 * Escape, the backdrop and (on mobile) the × close it, Tab stays inside it,
 * and focus goes back to whatever opened it. Below the mobile breakpoint the
 * same dialog slides up as a bottom sheet, matching `MobileSheet.vue`, so a
 * dialog never needs a separate phone layout.
 *
 * With `as="form"` the panel is a `<form>`: Enter in a field submits, and the
 * submit arrives as the `submit` event with the default already prevented.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { useI18n } from "../../i18n";
import { useViewport } from "../../mobile/useViewport";
import { focusableIn, modalStack, trapTab } from "./focus-trap";

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    /** `form` makes Enter submit; the body's inputs then belong to one form. */
    as?: "div" | "form";
    /** Desktop width; the sheet is always full width. */
    width?: string;
    /**
     * False while something must not be interrupted (a save in flight):
     * Escape, the backdrop and the × then do nothing.
     */
    dismissible?: boolean;
    /** Tints the title for destructive prompts ("delete channel?"). */
    danger?: boolean;
  }>(),
  { as: "div", width: "360px", dismissible: true, danger: false },
);

const emit = defineEmits<{
  close: [];
  submit: [];
}>();

const { t } = useI18n();
const { isMobile } = useViewport();
const titleId = useId();
const subtitleId = useId();
const panel = ref<HTMLElement | null>(null);
const body = ref<HTMLElement | null>(null);
const stackId = Symbol("dialog");
/** Focus to hand back on close: the button or menu item that opened us. */
let opener: HTMLElement | null = null;
/**
 * Set by a press that started on the backdrop itself. A drag that starts in a
 * field (selecting text) and ends over the backdrop also fires a click there,
 * and must not throw the half-filled dialog away.
 */
let pressOnBackdrop = false;

function requestClose(): void {
  if (props.dismissible) emit("close");
}

function onBackdropDown(ev: PointerEvent): void {
  pressOnBackdrop = ev.target === ev.currentTarget;
}

function onBackdropClick(ev: MouseEvent): void {
  if (pressOnBackdrop && ev.target === ev.currentTarget) requestClose();
  pressOnBackdrop = false;
}

/** Document-level so Escape works even when focus has left the dialog. */
function onKey(ev: KeyboardEvent): void {
  if (!modalStack.isTop(stackId)) return;
  if (ev.key === "Escape") {
    ev.stopPropagation();
    requestClose();
  } else if (panel.value) {
    trapTab(panel.value, ev);
  }
}

/**
 * `autofocus` only works on page load, and dialogs mount later, so pick the
 * first field ourselves: an explicit `[autofocus]` anywhere wins, then the
 * first field of the body, then the first action, then the panel itself (so
 * Tab starts inside either way).
 */
function focusInitial(): void {
  const root = panel.value;
  if (!root) return;
  const target =
    root.querySelector<HTMLElement>("[autofocus]") ??
    (body.value ? focusableIn(body.value)[0] : undefined) ??
    focusableIn(root).find((el) => !el.classList.contains("close")) ??
    root;
  target.focus();
}

function onSubmit(): void {
  emit("submit");
}

onMounted(() => {
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalStack.push(stackId);
  document.addEventListener("keydown", onKey);
  // Teleported content is in the DOM by now, but a child that renders its
  // input conditionally may need one more tick.
  void nextTick(focusInitial);
});

onBeforeUnmount(() => {
  modalStack.remove(stackId);
  document.removeEventListener("keydown", onKey);
  // The opener can be gone (a context menu that closed itself); only return
  // focus to something still on the page.
  if (opener?.isConnected) opener.focus();
});
</script>

<template>
  <!-- On <body>: a blurred (glass) dock panel would otherwise pin this overlay to itself. -->
  <teleport to="body">
    <div
      class="dialog-backdrop"
      :class="{ sheet: isMobile }"
      @pointerdown="onBackdropDown"
      @click="onBackdropClick"
    >
      <component
        :is="props.as"
        ref="panel"
        class="dialog-panel glass"
        :class="{ sheet: isMobile }"
        :style="isMobile ? undefined : { width: `min(${props.width}, 94vw)` }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="subtitle ? subtitleId : undefined"
        tabindex="-1"
        @submit.prevent="onSubmit"
      >
        <header class="dialog-head">
          <span v-if="isMobile" class="grip" aria-hidden="true"></span>
          <div class="titles">
            <h3 :id="titleId" :class="{ danger }">{{ title }}</h3>
            <p v-if="subtitle" :id="subtitleId" class="subtitle">{{ subtitle }}</p>
          </div>
          <button
            v-if="isMobile && dismissible"
            type="button"
            class="close"
            :title="t('dialog.close')"
            :aria-label="t('dialog.close')"
            @click="requestClose"
          >
            ×
          </button>
        </header>
        <div ref="body" class="dialog-body">
          <slot></slot>
        </div>
        <footer v-if="$slots.footer" class="dialog-actions">
          <slot name="footer"></slot>
        </footer>
      </component>
    </div>
  </teleport>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  /* Above the mobile sheets (60): a dialog can be opened from one. */
  z-index: 70;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  overflow: auto;
}
.dialog-panel {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: calc(100vh - 32px);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  outline: none;
}
.dialog-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.titles {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
h3,
.subtitle {
  margin: 0;
}
h3.danger {
  color: var(--danger);
}
.subtitle {
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.dialog-body {
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
/* Footer buttons come from the caller's slot, so reach them with :slotted. */
.dialog-actions :slotted(.primary) {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
.dialog-actions :slotted(.danger) {
  background: var(--danger);
  border-color: var(--danger);
  color: white;
}

/* ---- bottom sheet (mobile) — the look of MobileSheet.vue ---- */
.dialog-backdrop.sheet {
  display: flex;
  align-items: flex-end;
}
.dialog-panel.sheet {
  width: 100%;
  max-height: 85vh;
  border: none;
  border-top: 1px solid var(--border);
  border-radius: 16px 16px 0 0;
  box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.55);
  padding: 0 14px calc(14px + env(safe-area-inset-bottom, 0px));
  gap: 12px;
}
.sheet .dialog-head {
  position: relative;
  align-items: center;
  padding: 14px 0 8px;
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
.sheet h3 {
  font-size: 15px;
  font-weight: 600;
}
.close {
  flex: none;
  border: none;
  background: transparent;
  font-size: 22px;
  line-height: 1;
  padding: 4px 12px;
  color: var(--text-dim);
}
.sheet .dialog-body {
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
/* Thumb-sized actions, each taking an equal share of the row. */
.sheet .dialog-actions :slotted(button) {
  flex: 1;
  min-height: 44px;
}
</style>
