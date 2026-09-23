<script setup lang="ts">
/** Maximum clients in the channel, and in the channel with its subchannels. */
import { useI18n } from "../../i18n";
import type { ChannelFormState } from "./useChannelForm";

const props = defineProps<{ state: ChannelFormState }>();
const { t } = useI18n();
const form = props.state.form;
const v = form.values;
</script>

<template>
  <fieldset>
    <legend>{{ t("chm.maxClients") }}</legend>
    <label class="opt">
      <input v-model="v.maxClientsLimited" type="radio" name="channel-max" :value="false" />
      {{ t("chm.unlimited") }}
    </label>
    <label class="opt">
      <input v-model="v.maxClientsLimited" type="radio" name="channel-max" :value="true" />
      {{ t("chm.limited") }}
      <input
        v-model.number="v.maxClients"
        class="num"
        type="number"
        name="channel-max-clients"
        min="0"
        :disabled="!v.maxClientsLimited"
        :aria-label="t('chm.maxClients')"
        @blur="form.touch('maxClients')"
      />
    </label>
    <p v-if="form.errors.maxClients" class="note error">{{ form.errors.maxClients }}</p>
  </fieldset>
  <fieldset>
    <legend>{{ t("chm.maxFamily") }}</legend>
    <label class="opt">
      <input v-model="v.familyMode" type="radio" name="channel-family" value="inherit" />
      {{ t("chm.familyInherit") }}
    </label>
    <label class="opt">
      <input v-model="v.familyMode" type="radio" name="channel-family" value="unlimited" />
      {{ t("chm.unlimited") }}
    </label>
    <label class="opt">
      <input v-model="v.familyMode" type="radio" name="channel-family" value="limited" />
      {{ t("chm.limited") }}
      <input
        v-model.number="v.maxFamilyClients"
        class="num"
        type="number"
        name="channel-max-family"
        min="0"
        :disabled="v.familyMode !== 'limited'"
        :aria-label="t('chm.maxFamily')"
        @blur="form.touch('maxFamilyClients')"
      />
    </label>
    <p v-if="form.errors.maxFamilyClients" class="note error">{{ form.errors.maxFamilyClients }}</p>
  </fieldset>
</template>

<style scoped>
fieldset {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
legend {
  color: var(--text-dim);
  font-size: 12px;
  padding: 0 4px;
}
.opt {
  display: flex;
  align-items: center;
  gap: 8px;
}
.num {
  width: 90px;
}
.note.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
