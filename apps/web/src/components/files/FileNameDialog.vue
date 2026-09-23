<script setup lang="ts">
/**
 * One name for the file browser: a new folder, or the new name of a file or
 * folder. The check against the listing and the server's refusal both show
 * under the field (useFileEdits); the dialog stays open until it works.
 */
import { ref } from "vue";
import { FT_NAME_MAX } from "@jinz/protocol";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useI18n } from "../../i18n";

const props = defineProps<{
  title: string;
  label: string;
  submitLabel: string;
  initial: string;
  error: string | null;
  busy: boolean;
}>();
const emit = defineEmits<{ submit: [name: string]; close: [] }>();
const { t } = useI18n();
const name = ref(props.initial);
</script>

<template>
  <AppDialog
    as="form"
    width="340px"
    :title="title"
    :dismissible="!busy"
    @submit="emit('submit', name)"
    @close="emit('close')"
  >
    <FormField v-slot="f" :label="label" :error="error">
      <input
        :id="f.id"
        v-model="name"
        :maxlength="FT_NAME_MAX"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
        autocomplete="off"
        autofocus
      />
    </FormField>
    <template #footer>
      <button type="button" :disabled="busy" @click="emit('close')">
        {{ t("dialog.cancel") }}
      </button>
      <button type="submit" class="primary" :disabled="busy || !name.trim()">
        {{ submitLabel }}
      </button>
    </template>
  </AppDialog>
</template>
