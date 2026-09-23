<script setup lang="ts">
/**
 * The server's connection statistics (`serverrequestconnectioninfo`) in the
 * server info panel, refreshed while it is on screen: every request is a
 * command on the server from the hub's shared address, so it goes through
 * the hub's paced `ts.cmd` budget like any other, one at a time, and pauses
 * while the tab is hidden and stops when the panel closes. After a refusal
 * it asks far less often: the panel is only shown to those whose permissions
 * say yes, so a refusal usually means a group change the server has not
 * finished applying, not one that will stand.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useI18n } from "../../i18n";
import { formatUptime } from "../../ts/assets";
import { errorText } from "../admin/useBusy";
import { formatBytes, formatLoss, formatRate } from "./format";
import { readConnectionInfo } from "./server-actions";
import type { ConnectionInfo } from "./server-rows";

/** TeamSpeak's own client refreshes this once a second; every 5 s is plenty for a glance. */
const POLL_MS = 5_000;
/** After a refusal. */
const REFUSED_POLL_MS = 30_000;

const { t } = useI18n();
const info = shallowRef<ConnectionInfo | null>(null);
const error = ref<string | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

async function poll(): Promise<void> {
  timer = null;
  if (stopped) return;
  let wait = POLL_MS;
  if (document.visibilityState === "visible") {
    try {
      info.value = await readConnectionInfo();
      error.value = null;
    } catch (err) {
      error.value = errorText(err);
      wait = REFUSED_POLL_MS;
    }
  }
  if (!stopped) timer = setTimeout(() => void poll(), wait);
}

onMounted(() => void poll());
onBeforeUnmount(() => {
  stopped = true;
  if (timer) clearTimeout(timer);
});
</script>

<template>
  <div class="block" data-testid="conn-info">
    <div class="label">{{ t("server.conn.title") }}</div>
    <p v-if="error" class="err" role="alert">{{ error }}</p>
    <dl v-else-if="info" class="grid">
      <dt>{{ t("server.conn.ping") }}</dt>
      <dd data-testid="conn-ping">{{ info.ping.toFixed(0) }} ms</dd>
      <dt>{{ t("server.conn.loss") }}</dt>
      <dd data-testid="conn-loss">{{ formatLoss(info.packetLoss) }}</dd>
      <dt>{{ t("server.conn.bandwidth") }}</dt>
      <dd data-testid="conn-bandwidth">
        ↑ {{ formatRate(info.bandwidthSentSecond) }} · ↓
        {{ formatRate(info.bandwidthReceivedSecond) }}
      </dd>
      <dt>{{ t("server.conn.bandwidthMinute") }}</dt>
      <dd>
        ↑ {{ formatRate(info.bandwidthSentMinute) }} · ↓
        {{ formatRate(info.bandwidthReceivedMinute) }}
      </dd>
      <dt>{{ t("server.conn.fileTransfer") }}</dt>
      <dd>
        ↑ {{ formatRate(info.fileBandwidthSent) }} · ↓
        {{ formatRate(info.fileBandwidthReceived) }}
      </dd>
      <dt>{{ t("server.conn.totals") }}</dt>
      <dd data-testid="conn-totals">
        ↑ {{ formatBytes(info.bytesSent) }} · ↓ {{ formatBytes(info.bytesReceived) }}
      </dd>
      <dt>{{ t("server.conn.packets") }}</dt>
      <dd data-testid="conn-packets">
        ↑ {{ info.packetsSent.toLocaleString() }} · ↓ {{ info.packetsReceived.toLocaleString() }}
      </dd>
      <dt>{{ t("server.conn.connected") }}</dt>
      <dd>{{ formatUptime(info.connectedSeconds) }}</dd>
    </dl>
    <p v-else class="meta">{{ t("server.conn.loading") }}</p>
  </div>
</template>

<style scoped>
.label {
  color: var(--text-dim);
  font-size: 12px;
  margin-bottom: 4px;
}
.grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  margin: 0;
  align-items: baseline;
}
.grid dt {
  color: var(--text-dim);
  font-size: 12px;
  white-space: nowrap;
}
.grid dd {
  margin: 0;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.err {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
  overflow-wrap: anywhere;
}
.meta {
  color: var(--text-dim);
  font-size: 12px;
  margin: 0;
}
</style>
