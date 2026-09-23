<script setup lang="ts">
/**
 * "Move channel…": a new parent and a position among its subchannels, for
 * where dragging in the tree is not an option (touch browsers fire no HTML5
 * drag events; keyboards). The pick becomes the same command a drop would
 * (planChannelPlace / placeChannel), and the menu offers it under the same
 * gate as dragging (channelPerms' canMove). Closes if the channel is deleted
 * meanwhile; a refusal from the server is shown above the buttons.
 */
import { computed, ref, watch } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useTsStore } from "../../stores/ts";
import { useI18n } from "../../i18n";
import { displayChannelName } from "../../ts/format";
import { channelPickerRows } from "../../ts/moderation";
import { orderChoices } from "../../ts/channel-form";
import { isInSubtree, planChannelPlace } from "../../ts/channel-drop";
import { placeChannel } from "../../ts/channel-actions";

const props = defineProps<{ channelId: string }>();
const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const { t } = useI18n();

const channel = computed(() => ts.channels.get(props.channelId) ?? null);
const parentId = ref(channel.value?.parentId ?? "0");
const order = ref(channel.value?.order ?? "0");
const busy = ref(false);
const error = ref<string | null>(null);

/** Every channel it may go under: not itself, nor anything below it. */
const parents = computed(() =>
  channelPickerRows(ts.tree, "").filter(
    (r) => !isInSubtree(ts.channels, r.channel.id, props.channelId),
  ),
);
const orders = computed(() => orderChoices(ts.channels.values(), parentId.value, props.channelId));
const plan = computed(() =>
  planChannelPlace(ts.channels, props.channelId, parentId.value, order.value),
);

// Another parent: start at the end of its subchannels, as a drop onto it would.
watch(parentId, () => {
  order.value = orders.value[orders.value.length - 1]!.value;
  error.value = null;
});
watch(channel, (ch) => ch === null && emit("close"));

const indent = (depth: number) => "  ".repeat(depth + 1);

async function move(): Promise<void> {
  if (busy.value || !plan.value) return;
  busy.value = true;
  error.value = null;
  try {
    await placeChannel(plan.value);
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    as="form"
    width="420px"
    :title="t('chm.moveTitle')"
    :subtitle="channel ? displayChannelName(channel.name, channel.parentId) : undefined"
    :dismissible="!busy"
    @submit="move"
    @close="emit('close')"
  >
    <FormField v-slot="f" data-testid="move-channel-dialog" :label="t('chm.moveParent')">
      <select :id="f.id" v-model="parentId" name="parent" :aria-describedby="f.describedby">
        <option value="0">{{ t("chm.moveTopLevel") }}</option>
        <option v-for="r in parents" :key="r.channel.id" :value="r.channel.id">
          {{ indent(r.depth) + displayChannelName(r.channel.name, r.channel.parentId) }}
        </option>
      </select>
    </FormField>
    <FormField
      v-slot="f"
      :label="t('chm.order')"
      :hint="plan ? undefined : t('chm.moveUnchanged')"
      :error="error"
    >
      <select :id="f.id" v-model="order" name="order" :aria-describedby="f.describedby">
        <option v-for="o in orders" :key="o.value" :value="o.value">
          {{ o.name === null ? t("chm.orderFirst") : t("chm.orderAfter", { name: o.name }) }}
        </option>
      </select>
    </FormField>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="primary" :disabled="busy || !plan">
        {{ t("chm.moveSubmit") }}
      </button>
    </template>
  </AppDialog>
</template>
