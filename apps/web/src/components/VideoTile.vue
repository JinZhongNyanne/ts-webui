<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { TrackView } from "../stores/rtc";

const props = defineProps<{ view: TrackView; muted?: boolean }>();
const el = ref<HTMLVideoElement | HTMLAudioElement | null>(null);
let attached: TrackView | null = null;

function attach(): void {
  if (!el.value) return;
  props.view.attach(el.value);
  attached = props.view;
}
function detach(): void {
  if (el.value && attached) attached.detach(el.value);
  attached = null;
}

onMounted(attach);
watch(
  () => props.view,
  () => {
    detach();
    attach();
  },
);
onBeforeUnmount(detach);

defineExpose({ el });
</script>

<template>
  <video
    v-if="view.kind === 'video'"
    ref="el"
    class="tile"
    :class="{ mirror: view.isLocal && view.source === 'camera' }"
    autoplay
    playsinline
    muted
  ></video>
  <audio v-else ref="el" autoplay :muted="muted"></audio>
</template>

<style scoped>
.tile {
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000;
  border-radius: 10px;
}
.mirror {
  transform: scaleX(-1);
}
</style>
