<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";

/**
 * A plain modal shell for the identity and bookmark managers: backdrop, title,
 * close button, Escape to close. Kept local and small on purpose; a shared
 * dialog component can replace it later without touching the contents.
 */
defineProps<{ title: string; wide?: boolean }>();
const emit = defineEmits<{ close: [] }>();

function onKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape") {
    ev.stopPropagation();
    emit("close");
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- On <body>: a blurred (glass) ancestor would otherwise pin the overlay to itself. -->
  <teleport to="body">
    <div class="m1-overlay" @click.self="emit('close')">
      <section
        class="m1-modal"
        :class="{ wide }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
      >
        <header>
          <h3>{{ title }}</h3>
          <button type="button" class="close" :aria-label="$t('m1.close')" @click="emit('close')">
            ✕
          </button>
        </header>
        <div class="body">
          <slot></slot>
        </div>
      </section>
    </div>
  </teleport>
</template>

<style scoped>
.m1-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 16px;
}
.m1-modal {
  width: min(520px, 100%);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.m1-modal.wide {
  width: min(720px, 100%);
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 10px;
  border-bottom: 1px solid var(--border);
}
h3 {
  margin: 0;
  font-size: 16px;
}
.close {
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
}
.body {
  overflow: auto;
  padding: 14px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
