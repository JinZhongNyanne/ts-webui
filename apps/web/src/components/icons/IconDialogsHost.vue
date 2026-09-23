<script setup lang="ts">
/** Renders the icon manager when asked for (icon-dialogs.ts); a dropped connection closes it. */
import { watch } from "vue";
import { useTsStore } from "../../stores/ts";
import { closeIconDialog, iconDialog } from "./icon-dialogs";
import IconManagerDialog from "./IconManagerDialog.vue";

const ts = useTsStore();

watch(
  () => ts.connState,
  (state) => {
    if (state !== "connected") closeIconDialog();
  },
);
</script>

<template>
  <IconManagerDialog
    v-if="iconDialog"
    :key="JSON.stringify(iconDialog.target)"
    :target="iconDialog.target"
    @close="closeIconDialog"
  />
</template>
