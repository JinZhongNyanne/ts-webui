<script setup lang="ts">
/** Renders whichever M2 admin tool dialog is in the shared slot (see ClientDialogsHost). */
import { closeClientDialog, openClientDialog } from "../client/client-dialogs";
import type { AdminDialog } from "./admin-dialogs";
import ComplainDialog from "./ComplainDialog.vue";
import ComplaintsDialog from "./ComplaintsDialog.vue";
import InboxDialog from "./InboxDialog.vue";
import ComposeMessageDialog from "./ComposeMessageDialog.vue";
import ClientDbDialog from "./ClientDbDialog.vue";
import TempPasswordsDialog from "./TempPasswordsDialog.vue";

const props = defineProps<{ dialog: AdminDialog }>();

function closeCompose(): void {
  const d = props.dialog;
  if (d.kind === "composeMessage" && d.back === "inbox") openClientDialog({ kind: "inbox" });
  else closeClientDialog();
}
</script>

<template>
  <ComplainDialog
    v-if="dialog.kind === 'complain'"
    :db-id="dialog.dbId"
    :nickname="dialog.nickname"
    @close="closeClientDialog"
  />
  <ComplaintsDialog v-else-if="dialog.kind === 'complaints'" @close="closeClientDialog" />
  <InboxDialog v-else-if="dialog.kind === 'inbox'" @close="closeClientDialog" />
  <ComposeMessageDialog
    v-else-if="dialog.kind === 'composeMessage'"
    :uid="dialog.uid"
    :nickname="dialog.nickname"
    :subject="dialog.subject"
    @close="closeCompose"
  />
  <ClientDbDialog v-else-if="dialog.kind === 'clientDb'" @close="closeClientDialog" />
  <TempPasswordsDialog v-else-if="dialog.kind === 'tempPasswords'" @close="closeClientDialog" />
</template>
