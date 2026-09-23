<script setup lang="ts">
/** A site's icon as the hub fetched it, or its first letter when it has none. */
import { computed, ref, watch } from "vue";
import type { SharedApp } from "@jinz/protocol";
import { useWebAppsStore } from "../../stores/webApps";

const props = defineProps<{ app: SharedApp }>();
const store = useWebAppsStore();
const failed = ref(false);

const src = computed(() => store.iconUrl(props.app));
watch(src, () => (failed.value = false));
const letter = computed(() => props.app.name.trim().charAt(0).toUpperCase() || "?");
</script>

<template>
  <img v-if="src && !failed" class="app-icon" :src="src" alt="" @error="failed = true" />
  <span v-else class="app-icon letter" aria-hidden="true">{{ letter }}</span>
</template>

<style scoped>
.app-icon {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  object-fit: contain;
}
.letter {
  display: inline-grid;
  place-items: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--bg);
  background: var(--accent);
}
</style>
