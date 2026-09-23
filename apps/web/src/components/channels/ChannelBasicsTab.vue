<script setup lang="ts">
/** Name, phonetic name, topic and password of the channel dialog. */
import FormField from "../ui/FormField.vue";
import { useI18n } from "../../i18n";
import { CHANNEL_NAME_MAX, CHANNEL_PASSWORD_MAX, CHANNEL_TOPIC_MAX } from "../../ts/channel-form";
import type { ChannelFormState } from "./useChannelForm";

const props = defineProps<{ state: ChannelFormState }>();
const { t } = useI18n();
const form = props.state.form;
const v = form.values;
</script>

<template>
  <FormField v-slot="f" :label="t('chm.name')" :error="form.errors.name" required>
    <input
      :id="f.id"
      v-model="v.name"
      name="channel-name"
      :maxlength="CHANNEL_NAME_MAX"
      autocomplete="off"
      autofocus
      :aria-describedby="f.describedby"
      :aria-invalid="f.invalid"
      @blur="form.touch('name')"
    />
  </FormField>
  <FormField
    v-slot="f"
    :label="t('chm.namePhonetic')"
    :hint="t('chm.namePhoneticHint')"
    :error="form.errors.namePhonetic"
  >
    <input
      :id="f.id"
      v-model="v.namePhonetic"
      name="channel-phonetic"
      :maxlength="CHANNEL_NAME_MAX"
      autocomplete="off"
      :aria-describedby="f.describedby"
    />
  </FormField>
  <FormField v-slot="f" :label="t('chm.topic')" :error="form.errors.topic">
    <input
      :id="f.id"
      v-model="v.topic"
      name="channel-topic"
      :maxlength="CHANNEL_TOPIC_MAX"
      autocomplete="off"
      :aria-describedby="f.describedby"
    />
  </FormField>
  <label class="check">
    <input
      v-model="v.hasPassword"
      type="checkbox"
      name="channel-has-password"
      :disabled="v.isDefault"
    />
    {{ t("chm.passwordProtect") }}
  </label>
  <p v-if="form.errors.hasPassword" class="note error">{{ form.errors.hasPassword }}</p>
  <FormField
    v-if="v.hasPassword"
    v-slot="f"
    :label="t('chm.password')"
    :hint="state.editing && state.hadPassword ? t('chm.passwordKeep') : undefined"
    :error="form.errors.password"
  >
    <input
      :id="f.id"
      v-model="v.password"
      name="channel-password"
      type="password"
      :maxlength="CHANNEL_PASSWORD_MAX"
      autocomplete="new-password"
      :aria-describedby="f.describedby"
      :aria-invalid="f.invalid"
      @blur="form.touch('password')"
    />
  </FormField>
</template>

<style scoped>
.check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.note.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
