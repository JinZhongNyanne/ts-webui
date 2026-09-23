<script setup lang="ts">
/**
 * Renders the channel dialog `openChannelDialog()` asked for. A dropped
 * connection closes it: it acts on the live session.
 */
import { watch } from "vue";
import { useTsStore } from "../../stores/ts";
import { channelDialog, closeChannelDialog } from "./channel-dialogs";
import ChannelEditDialog from "./ChannelEditDialog.vue";
import MoveChannelDialog from "./MoveChannelDialog.vue";

const ts = useTsStore();

watch(
  () => ts.connState,
  (state) => {
    if (state !== "connected") closeChannelDialog();
  },
);
</script>

<template>
  <MoveChannelDialog
    v-if="channelDialog?.kind === 'move'"
    :key="`m${channelDialog.channelId}`"
    :channel-id="channelDialog.channelId"
    @close="closeChannelDialog"
  />
  <ChannelEditDialog
    v-else-if="channelDialog"
    :key="
      channelDialog.kind === 'edit' ? `e${channelDialog.channelId}` : `c${channelDialog.parentId}`
    "
    :dialog="channelDialog"
    @close="closeChannelDialog"
  />
</template>
