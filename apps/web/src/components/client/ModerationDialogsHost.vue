<script setup lang="ts">
/**
 * The M2 moderation dialogs, rendered from the same `clientDialog` slot as
 * the M1 ones (ClientDialogsHost mounts this and closes the slot when the
 * connection drops). Keyed by client so a dialog for someone else starts
 * fresh; each one pins its target by UID and closes when they leave
 * (useTargetClient).
 */
import { closeClientDialog, type ModerationDialog } from "./client-dialogs";
import MoveClientDialog from "./MoveClientDialog.vue";
import KickDialog from "./KickDialog.vue";
import ServerGroupsDialog from "./ServerGroupsDialog.vue";
import ChannelGroupDialog from "./ChannelGroupDialog.vue";

defineProps<{ dialog: ModerationDialog }>();
</script>

<template>
  <MoveClientDialog
    v-if="dialog.kind === 'move'"
    :key="`move${dialog.clientId}`"
    :client-id="dialog.clientId"
    :channel-id="dialog.channelId"
    @close="closeClientDialog"
  />
  <KickDialog
    v-else-if="dialog.kind === 'kick'"
    :key="`kick${dialog.scope}${dialog.clientId}`"
    :client-id="dialog.clientId"
    :scope="dialog.scope"
    @close="closeClientDialog"
  />
  <ServerGroupsDialog
    v-else-if="dialog.kind === 'serverGroups'"
    :key="`sg${dialog.clientId}`"
    :client-id="dialog.clientId"
    @close="closeClientDialog"
  />
  <ChannelGroupDialog
    v-else
    :key="`cg${dialog.clientId}`"
    :client-id="dialog.clientId"
    @close="closeClientDialog"
  />
</template>
