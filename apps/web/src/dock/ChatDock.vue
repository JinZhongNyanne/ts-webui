<script setup lang="ts">
import { computed } from "vue";
import ChatPanel from "../components/ChatPanel.vue";

/** dockview hands panel params in `params.params`; we carry the conversation key there. */
const props = defineProps<{ params?: { params?: { conversation?: string } } }>();
const conversation = computed(() => props.params?.params?.conversation ?? "server");
</script>

<template>
  <div class="dock-fill">
    <ChatPanel :conversation="conversation" />
  </div>
</template>
