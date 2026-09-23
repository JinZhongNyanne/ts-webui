<script setup lang="ts">
/**
 * Renders whichever dialog `openClientDialog()` asked for: the M1
 * self-service ones here, the M2 bans here too, the moderation, admin and
 * M4 server ones through their own hosts. Mounted once in App.vue. A dropped
 * connection closes it: every one of these acts on the live session, and a
 * new session may be another server.
 *
 * The branches cover every ClientDialog kind; the last one only type-checks
 * while that holds (see unhostedDialog).
 */
import { watch } from "vue";
import { useTsStore } from "../../stores/ts";
import {
  clientDialog,
  closeClientDialog,
  isModerationDialog,
  unhostedDialog,
} from "./client-dialogs";
import NicknameDialog from "./NicknameDialog.vue";
import AwayDialog from "./AwayDialog.vue";
import DescriptionDialog from "./DescriptionDialog.vue";
import TalkRequestDialog from "./TalkRequestDialog.vue";
import ChannelDialogsHost from "../channels/ChannelDialogsHost.vue";
import IconDialogsHost from "../icons/IconDialogsHost.vue";
import ModerationDialogsHost from "./ModerationDialogsHost.vue";
import BanDialog from "../bans/BanDialog.vue";
import BanListDialog from "../bans/BanListDialog.vue";
import AdminDialogs from "../admin/AdminDialogs.vue";
import { isAdminDialog } from "../admin/admin-dialogs";
import ServerDialogs from "../server/ServerDialogs.vue";
import { isServerDialog } from "../server/server-dialogs";

const ts = useTsStore();

watch(
  () => ts.connState,
  (state) => {
    if (state !== "connected") closeClientDialog();
  },
);
</script>

<template>
  <NicknameDialog v-if="clientDialog?.kind === 'nickname'" @close="closeClientDialog" />
  <AwayDialog v-else-if="clientDialog?.kind === 'away'" @close="closeClientDialog" />
  <TalkRequestDialog v-else-if="clientDialog?.kind === 'talkRequest'" @close="closeClientDialog" />
  <DescriptionDialog
    v-else-if="clientDialog?.kind === 'description'"
    :key="clientDialog.clientId"
    :client-id="clientDialog.clientId"
    @close="closeClientDialog"
  />
  <BanDialog
    v-else-if="clientDialog?.kind === 'ban'"
    :key="`ban-${clientDialog.clientId}`"
    :client-id="clientDialog.clientId"
    @close="closeClientDialog"
  />
  <BanListDialog v-else-if="clientDialog?.kind === 'banList'" @close="closeClientDialog" />
  <AdminDialogs v-else-if="isAdminDialog(clientDialog)" :dialog="clientDialog" />
  <ServerDialogs v-else-if="isServerDialog(clientDialog)" :dialog="clientDialog" />
  <ModerationDialogsHost v-else-if="isModerationDialog(clientDialog)" :dialog="clientDialog" />
  <template v-else-if="clientDialog">{{ unhostedDialog(clientDialog) }}</template>
  <ChannelDialogsHost />
  <IconDialogsHost />
</template>
