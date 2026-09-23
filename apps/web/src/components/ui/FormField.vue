<script setup lang="ts">
/**
 * One labelled form row: label, the caller's control, then a hint or an error.
 *
 * The control comes in through the default slot, which receives the ids to
 * wire up (`id`, `describedby`, `invalid`) — so a screen reader reads the
 * label, and the error rather than the hint once there is one, for any kind
 * of control without this component having to know which it is:
 *
 *   <FormField :label="t('x')" :error="form.errors.name" v-slot="f">
 *     <input :id="f.id" v-model="form.values.name"
 *            :aria-describedby="f.describedby" :aria-invalid="f.invalid" />
 *   </FormField>
 */
import { computed, useId } from "vue";

const props = defineProps<{
  label: string;
  hint?: string;
  /** Shown instead of the hint, in the danger colour. Empty or null = none. */
  error?: string | null;
  /** Marks the label; validation itself is the form's job. */
  required?: boolean;
}>();

defineSlots<{
  default(props: { id: string; describedby: string | undefined; invalid: boolean }): unknown;
}>();

const id = useId();
const noteId = useId();
const invalid = computed(() => !!props.error);
const note = computed(() => props.error || props.hint || "");
</script>

<template>
  <div class="field" :class="{ invalid }">
    <label :for="id">
      {{ label }}<span v-if="required" class="req" aria-hidden="true"> *</span>
    </label>
    <slot :id="id" :describedby="note ? noteId : undefined" :invalid="invalid"></slot>
    <!-- aria-live so an error that appears on blur or submit is announced. -->
    <p v-if="note" :id="noteId" class="note" :class="{ error: invalid }" aria-live="polite">
      {{ note }}
    </p>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
label {
  color: var(--text-dim);
  font-size: 12px;
}
.req {
  color: var(--danger);
}
.field :slotted(input),
.field :slotted(select),
.field :slotted(textarea) {
  width: 100%;
}
.invalid :slotted(input),
.invalid :slotted(select),
.invalid :slotted(textarea) {
  border-color: var(--danger);
}
.note {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
}
.note.error {
  color: var(--danger);
  font-size: 12px;
}
</style>
