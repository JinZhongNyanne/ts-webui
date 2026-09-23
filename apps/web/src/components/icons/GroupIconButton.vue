<script setup lang="ts">
/**
 * A group's icon at the end of its row in the M2 group dialogs; a click
 * opens the icon picker for that group (in place of the dialog). Only a
 * plain icon where setting one is not offered (see icon-gates.ts).
 */
import { computed } from "vue";
import type { TsGroup } from "@jinz/protocol";
import { useI18n } from "../../i18n";
import { builtinIcon, iconUrl } from "../../ts/assets";
import { openIconDialog } from "./icon-dialogs";
import { useIconGates } from "./useIconMenus";

const props = defineProps<{ kind: "serverGroup" | "channelGroup"; group: TsGroup }>();
const { t } = useI18n();
const gates = useIconGates();

const url = computed(() => iconUrl(props.group.iconId));
const glyph = computed(() => builtinIcon(props.group.iconId)?.glyph ?? "");
const canSet = computed(() => gates.assign(props.kind));

function open(): void {
  openIconDialog({ kind: props.kind, id: props.group.id, name: props.group.name });
}
</script>

<template>
  <button
    v-if="canSet"
    type="button"
    class="icon-btn"
    :title="t('icons.setIcon')"
    :aria-label="t('icons.setIconFor', { name: group.name })"
    data-testid="group-icon"
    @click.stop.prevent="open"
  >
    <img v-if="url" :src="url" alt="" />
    <span v-else-if="glyph">{{ glyph }}</span>
    <span v-else class="empty">🖼️</span>
  </button>
  <span v-else-if="url || glyph" class="icon-btn static">
    <img v-if="url" :src="url" alt="" />
    <span v-else>{{ glyph }}</span>
  </span>
</template>

<style scoped>
.icon-btn {
  margin-left: auto;
  width: 26px;
  height: 22px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  font-size: 12px;
  flex: none;
}
.icon-btn.static {
  border: 0;
}
.icon-btn img {
  width: 16px;
  height: 16px;
}
.empty {
  opacity: 0.45;
}
</style>
