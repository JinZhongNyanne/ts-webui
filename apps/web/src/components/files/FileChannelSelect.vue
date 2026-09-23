<script setup lang="ts">
/**
 * The file browser's channel picker: the channel tree as an indented list
 * (spacers left out), 🔒 on channels with a password, "(mine)" on the one I
 * am in. A native select, so a phone shows its own picker.
 */
import { computed } from "vue";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { displayChannelName } from "../../ts/format";
import { channelPickerRows } from "../../ts/moderation";

defineProps<{ modelValue: string | null }>();
const emit = defineEmits<{ "update:modelValue": [cid: string] }>();
const ts = useTsStore();
const { t } = useI18n();

const options = computed(() =>
  channelPickerRows(ts.tree, "").map(({ channel: ch, depth }) => {
    const name = displayChannelName(ch.name, ch.parentId);
    const mine = ch.id === ts.selfChannel?.id ? ` ${t("fb.mine")}` : "";
    const lock = ch.flags.password ? "🔒 " : "";
    // Non-breaking spaces: a select collapses ordinary ones.
    return { id: ch.id, label: `${"  ".repeat(depth)}${lock}${name}${mine}` };
  }),
);

function onChange(ev: Event): void {
  emit("update:modelValue", (ev.target as HTMLSelectElement).value);
}
</script>

<template>
  <select
    class="channel-select"
    :value="modelValue ?? ''"
    :aria-label="t('fb.channel')"
    data-testid="fb-channel"
    @change="onChange"
  >
    <option v-if="!modelValue" value="" disabled>{{ t("fb.noChannel") }}</option>
    <option v-for="o in options" :key="o.id" :value="o.id">{{ o.label }}</option>
  </select>
</template>

<style scoped>
.channel-select {
  min-width: 0;
  max-width: 100%;
  flex: 1 1 160px;
}
</style>
