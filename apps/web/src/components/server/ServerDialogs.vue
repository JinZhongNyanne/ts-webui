<script setup lang="ts">
/** Renders whichever M4 server dialog is in the shared slot (see ClientDialogsHost). */
import { closeClientDialog } from "../client/client-dialogs";
import type { ServerDialog } from "./server-dialogs";
import PrivilegeKeyUseDialog from "./PrivilegeKeyUseDialog.vue";
import PrivilegeKeysDialog from "./PrivilegeKeysDialog.vue";
import GroupsDialog from "./GroupsDialog.vue";
import ServerEditDialog from "./ServerEditDialog.vue";
import ServerLogDialog from "./ServerLogDialog.vue";
import PermOverviewDialog from "./PermOverviewDialog.vue";

defineProps<{ dialog: ServerDialog }>();
</script>

<template>
  <PrivilegeKeyUseDialog v-if="dialog.kind === 'privilegeKeyUse'" @close="closeClientDialog" />
  <PrivilegeKeysDialog v-else-if="dialog.kind === 'privilegeKeys'" @close="closeClientDialog" />
  <GroupsDialog v-else-if="dialog.kind === 'groups'" @close="closeClientDialog" />
  <ServerEditDialog v-else-if="dialog.kind === 'serverEdit'" @close="closeClientDialog" />
  <ServerLogDialog v-else-if="dialog.kind === 'serverLog'" @close="closeClientDialog" />
  <PermOverviewDialog
    v-else-if="dialog.kind === 'permOverview'"
    :key="`${dialog.dbId}-${dialog.channelId}`"
    :db-id="dialog.dbId"
    :channel-id="dialog.channelId"
    :nickname="dialog.nickname"
    @close="closeClientDialog"
  />
</template>
