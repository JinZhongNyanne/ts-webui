<script setup lang="ts">
/**
 * Adds a temporary server password (`servertemppasswordadd`): the password
 * (or a generated one), a description, how long it lasts, and optionally the
 * channel its users land in (with that channel's password when it has one).
 */
import { computed } from "vue";
import { TEMP_PASSWORD_DESC_MAX, TEMP_PASSWORD_MAX } from "@jinz/protocol";
import FormField from "../ui/FormField.vue";
import { rules, useForm } from "../../composables/useForm";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { addTempPassword } from "../../ts/admin-actions";
import { channelOptions, DURATION_PRESETS, generatePassword } from "../../ts/admin-rows";

const emit = defineEmits<{ added: []; cancel: [] }>();
const { t } = useI18n();
const ts = useTsStore();

const channels = computed(() => channelOptions(ts.channels.values()));

const form = useForm({
  initial: () => ({
    password: generatePassword(),
    description: "",
    seconds: DURATION_PRESETS[0]!.seconds,
    channelId: "",
    channelPassword: "",
  }),
  rules: {
    password: [rules.required(), rules.maxLength(TEMP_PASSWORD_MAX)],
    description: [rules.maxLength(TEMP_PASSWORD_DESC_MAX)],
  },
  onSubmit: async (v) => {
    try {
      await addTempPassword({
        password: v.password,
        description: v.description,
        seconds: v.seconds,
        channelId: v.channelId || undefined,
        // A password typed for a protected channel must not follow a switch to an open one.
        channelPassword: channelHasPassword.value ? v.channelPassword : "",
      });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  },
});

const channelHasPassword = computed(
  () => !!form.values.channelId && !!ts.channels.get(form.values.channelId)?.flags.password,
);

async function submit(): Promise<void> {
  if (await form.submit()) emit("added");
}
</script>

<template>
  <form class="tp-form" data-testid="temppw-form" @submit.prevent="submit">
    <FormField v-slot="f" :label="t('admin.tp.password')" :error="form.errors.password" required>
      <div class="toolbar">
        <input
          :id="f.id"
          v-model="form.values.password"
          class="grow"
          data-testid="temppw-password"
          :maxlength="TEMP_PASSWORD_MAX"
          autocomplete="off"
          :aria-describedby="f.describedby"
          :aria-invalid="f.invalid"
          @blur="form.touch('password')"
        />
        <button type="button" @click="form.values.password = generatePassword()">
          🎲 {{ t("admin.tp.generate") }}
        </button>
      </div>
    </FormField>
    <FormField v-slot="f" :label="t('admin.tp.description')" :error="form.errors.description">
      <input
        :id="f.id"
        v-model="form.values.description"
        data-testid="temppw-desc"
        :maxlength="TEMP_PASSWORD_DESC_MAX"
        autocomplete="off"
        :aria-describedby="f.describedby"
      />
    </FormField>
    <FormField v-slot="f" :label="t('admin.tp.duration')">
      <select :id="f.id" v-model.number="form.values.seconds" data-testid="temppw-duration">
        <option v-for="p in DURATION_PRESETS" :key="p.key" :value="p.seconds">
          {{ t(`admin.tp.dur.${p.key}` as "admin.tp.dur.1h") }}
        </option>
      </select>
    </FormField>
    <FormField v-slot="f" :label="t('admin.tp.channel')" :hint="t('admin.tp.channelHint')">
      <select
        :id="f.id"
        v-model="form.values.channelId"
        data-testid="temppw-channel"
        :aria-describedby="f.describedby"
      >
        <option value="">{{ t("admin.tp.noChannel") }}</option>
        <option v-for="c in channels" :key="c.id" :value="c.id">{{ c.path }}</option>
      </select>
    </FormField>
    <FormField v-if="channelHasPassword" v-slot="f" :label="t('admin.tp.channelPassword')">
      <input :id="f.id" v-model="form.values.channelPassword" autocomplete="off" />
    </FormField>
    <p v-if="form.formError.value" class="err" role="alert">{{ form.formError.value }}</p>
    <div class="toolbar end">
      <button type="button" @click="emit('cancel')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="form.submitting.value">
        {{ t("admin.tp.add") }}
      </button>
    </div>
  </form>
</template>

<style scoped src="./admin.css"></style>
<style scoped>
.tp-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.end {
  justify-content: flex-end;
}
select {
  font: inherit;
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
