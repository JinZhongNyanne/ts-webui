<script setup lang="ts">
/**
 * Modal single-field prompt used in place of `window.prompt`, so the dialog
 * can be styled and translated like the rest of the app.
 *
 * Enter submits (via the form), Escape or clicking the backdrop cancels.
 * The modal plumbing (focus, Escape, the mobile sheet) is `AppDialog`'s.
 */
import AppDialog from "./ui/AppDialog.vue";

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    modelValue: string;
    type?: "text" | "password";
    submitLabel: string;
    cancelLabel: string;
    maxlength?: number;
  }>(),
  { type: "text" },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  submit: [];
  cancel: [];
}>();

function onInput(ev: Event): void {
  emit("update:modelValue", (ev.target as HTMLInputElement).value);
}
</script>

<template>
  <AppDialog
    as="form"
    width="300px"
    :title="title"
    :subtitle="subtitle"
    @submit="emit('submit')"
    @close="emit('cancel')"
  >
    <input
      :value="modelValue"
      :type="type"
      :maxlength="maxlength"
      :aria-label="title"
      autofocus
      @input="onInput"
    />
    <template #footer>
      <button type="button" @click="emit('cancel')">{{ cancelLabel }}</button>
      <button type="submit" class="primary">{{ submitLabel }}</button>
    </template>
  </AppDialog>
</template>
