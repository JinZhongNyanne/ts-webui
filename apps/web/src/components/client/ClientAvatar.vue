<script setup lang="ts">
/**
 * A client's TeamSpeak avatar, or nothing: clients without one, and avatars
 * the hub cannot fetch (gone from the server, flood back-off), leave no
 * broken-image box behind. Give `avatar` (the client_flag_avatar hash) when
 * the client is at hand, or `uid` to look it up among the clients we see —
 * chat messages only know who wrote them.
 *
 * The hash is part of the URL, so a new avatar is a new URL and shows at once.
 */
import { computed, ref, watch } from "vue";
import { avatarByUid } from "./avatar-index";
import { avatarUrl } from "../../ts/assets";

const props = withDefaults(defineProps<{ avatar?: string; uid?: string; size?: number }>(), {
  avatar: undefined,
  uid: undefined,
  size: 16,
});

const byUid = avatarByUid();

const hash = computed(() => {
  if (props.avatar !== undefined) return props.avatar;
  return props.uid ? (byUid.value.get(props.uid) ?? "") : "";
});
const src = computed(() => avatarUrl(hash.value));
const failed = ref<string | null>(null);
watch(src, () => {
  failed.value = null;
});
</script>

<template>
  <img
    v-if="src && failed !== src"
    :src="src"
    class="avatar"
    :style="{ width: `${size}px`, height: `${size}px` }"
    alt=""
    loading="lazy"
    data-testid="client-avatar"
    @error="failed = src"
  />
</template>

<style scoped>
.avatar {
  border-radius: 50%;
  object-fit: cover;
  flex: none;
  background: var(--bg-elev-2);
}
</style>
