<script setup lang="ts">
/**
 * Channel type and default flag, needed talk power, position among the
 * siblings, icon and (temporary channels) delete delay.
 *
 * Making a channel the default also makes it permanent and drops its
 * password, as TeamSpeak requires; the default flag cannot be taken away
 * (the server wants another channel made default instead).
 */
import { computed } from "vue";
import FormField from "../ui/FormField.vue";
import { useI18n, type MessageKey } from "../../i18n";
import type { ChannelType } from "../../ts/channel-form";
import { PERM_CREATE_DEFAULT, PERM_MAKE_DEFAULT, PERM_SORTORDER } from "../../ts/channel-perms";
import type { ChannelFormState } from "./useChannelForm";

const props = defineProps<{ state: ChannelFormState }>();
const { t } = useI18n();
const s = props.state;
const form = s.form;
const v = form.values;

const TYPES: readonly { id: ChannelType; label: MessageKey }[] = [
  { id: "permanent", label: "chm.typePermanent" },
  { id: "semi", label: "chm.typeSemi" },
  { id: "temporary", label: "chm.typeTemporary" },
];

const canDefault = computed(
  () => !s.wasDefault && s.perms.mayTry(s.editing ? PERM_MAKE_DEFAULT : PERM_CREATE_DEFAULT),
);
const canSort = computed(() => !s.editing || s.perms.mayTry(PERM_SORTORDER));

function setDefault(on: boolean): void {
  v.isDefault = on;
  if (on) {
    v.type = "permanent";
    v.hasPassword = false;
  }
}
</script>

<template>
  <fieldset>
    <legend>{{ t("chm.type") }}</legend>
    <label v-for="ty in TYPES" :key="ty.id" class="opt">
      <input
        v-model="v.type"
        type="radio"
        name="channel-type"
        :value="ty.id"
        :disabled="
          (v.isDefault && ty.id !== 'permanent') ||
          (!s.typeChoices.value.includes(ty.id) && v.type !== ty.id)
        "
      />
      {{ t(ty.label) }}
    </label>
    <p v-if="form.errors.type" class="note error">{{ form.errors.type }}</p>
    <label class="opt" :title="s.wasDefault ? t('chm.defaultLocked') : undefined">
      <input
        type="checkbox"
        name="channel-default"
        :checked="v.isDefault"
        :disabled="!canDefault"
        @change="setDefault(($event.target as HTMLInputElement).checked)"
      />
      {{ t("chm.default") }}
    </label>
  </fieldset>
  <div class="row">
    <FormField
      v-slot="f"
      :label="t('chm.talkPower')"
      :hint="t('chm.talkPowerHint')"
      :error="form.errors.neededTalkPower"
    >
      <input
        :id="f.id"
        v-model.number="v.neededTalkPower"
        name="channel-talk-power"
        type="number"
        min="0"
        :aria-describedby="f.describedby"
      />
    </FormField>
    <FormField
      v-slot="f"
      :label="t('chm.icon')"
      :hint="t('chm.iconHint')"
      :error="form.errors.iconId"
    >
      <input
        :id="f.id"
        v-model.number="v.iconId"
        name="channel-icon"
        type="number"
        min="0"
        :aria-describedby="f.describedby"
      />
    </FormField>
  </div>
  <FormField v-slot="f" :label="t('chm.order')" :error="form.errors.order">
    <select :id="f.id" v-model="v.order" name="channel-order" :disabled="!canSort">
      <option v-for="o in s.orders.value" :key="o.value" :value="o.value">
        {{ o.name === null ? t("chm.orderFirst") : t("chm.orderAfter", { name: o.name }) }}
      </option>
    </select>
  </FormField>
  <FormField
    v-if="v.type === 'temporary'"
    v-slot="f"
    :label="t('chm.deleteDelay')"
    :hint="t('chm.deleteDelayHint')"
    :error="form.errors.deleteDelay"
  >
    <input
      :id="f.id"
      v-model.number="v.deleteDelay"
      name="channel-delete-delay"
      type="number"
      min="0"
      :aria-describedby="f.describedby"
      @blur="form.touch('deleteDelay')"
    />
  </FormField>
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
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.note.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}
</style>
