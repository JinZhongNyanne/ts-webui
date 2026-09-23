<script setup lang="ts">
/**
 * Read-only permission overview for one client in one channel
 * (`permoverview`): every permission that client has from anywhere, grouped
 * by TeamSpeak's categories (the catalog's `groupEnds`), each with the
 * sources that set it and the one that wins marked (perm-overview.ts). It
 * answers "why does this client have this permission"; changing anything is
 * the permission editor's job, which this phase does not include.
 *
 * Needs b_client_permissionoverview_view (or _own for oneself); without it
 * the server's refusal names the permission.
 */
import { computed, onMounted, ref, shallowRef } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import { useI18n } from "../../i18n";
import { useTsStore } from "../../stores/ts";
import { useBusy } from "../admin/useBusy";
import {
  explainOverview,
  parseCatalog,
  SOURCE,
  type CatalogView,
  type ExplainedSource,
  type PermSourceRow,
} from "./perm-overview";
import { permissionCatalog, permissionOverview } from "./server-actions";

const props = defineProps<{ dbId: string; channelId: string; nickname: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const ts = useTsStore();
const { busy, error, run } = useBusy();

const catalog = shallowRef<CatalogView | null>(null);
const sources = shallowRef<readonly PermSourceRow[]>([]);
const query = ref("");

const categories = computed(() =>
  catalog.value ? explainOverview(catalog.value, sources.value, query.value) : [],
);
const channelName = computed(() => ts.channels.get(props.channelId)?.name ?? `#${props.channelId}`);

async function load(): Promise<void> {
  const res = await run(() =>
    Promise.all([
      // Without the catalog (a server may refuse it) the ids still explain themselves.
      permissionCatalog().catch(() => parseCatalog([])),
      permissionOverview(props.channelId, props.dbId),
    ]),
  );
  if (!res) return;
  catalog.value = res[0];
  sources.value = res[1];
}

const channelOf = (id: string) => ts.channels.get(id)?.name ?? `#${id}`;

function sourceLabel(s: ExplainedSource): string {
  switch (s.kind) {
    case SOURCE.serverGroup:
      return t("server.perm.fromServerGroup", {
        name: ts.serverGroups.get(s.id1)?.name ?? `#${s.id1}`,
      });
    case SOURCE.client:
      return t("server.perm.fromClient");
    case SOURCE.channel:
      return t("server.perm.fromChannel", { channel: channelOf(s.id1) });
    case SOURCE.channelGroup:
      return t("server.perm.fromChannelGroup", {
        name: ts.channelGroups.get(s.id1)?.name ?? `#${s.id1}`,
        channel: channelOf(s.id2),
      });
    default:
      return t("server.perm.fromChannelClient", { channel: channelOf(s.id1) });
  }
}

onMounted(load);
</script>

<template>
  <AppDialog
    width="720px"
    :title="t('server.perm.title')"
    :subtitle="t('server.perm.subtitle', { name: nickname, channel: channelName })"
    @close="emit('close')"
  >
    <div class="toolbar" data-testid="permov-dialog">
      <input
        v-model="query"
        class="grow"
        type="search"
        data-testid="permov-search"
        :placeholder="t('server.perm.search')"
        :aria-label="t('server.perm.search')"
      />
      <button type="button" :disabled="busy" @click="load">{{ t("admin.refresh") }}</button>
    </div>
    <p class="meta hint">{{ t("server.perm.hint") }}</p>
    <p v-if="error" class="err" role="alert" data-testid="permov-error">{{ error }}</p>
    <p v-if="catalog && !categories.length && !error" class="empty">
      {{ t("server.perm.none") }}
    </p>
    <section v-for="(cat, i) in categories" :key="i" class="cat">
      <h3>{{ cat.label || t("server.perm.other") }}</h3>
      <ul class="rows">
        <li
          v-for="p in cat.perms"
          :key="p.id"
          class="row perm"
          data-testid="permov-row"
          :data-perm="p.name"
        >
          <div class="main">
            <span class="title">
              <code>{{ p.name }}</code>
              <span class="value" data-testid="permov-value">{{ p.value ?? "–" }}</span>
            </span>
            <span v-if="p.desc" class="meta">{{ p.desc }}</span>
            <ul class="sources">
              <li
                v-for="(s, j) in p.sources"
                :key="j"
                :class="{ decisive: s.decisive }"
                data-testid="permov-source"
              >
                <span>{{ sourceLabel(s) }}</span>
                <span class="num">{{ s.value }}</span>
                <span v-if="s.negated" class="flag">{{ t("server.perm.negated") }}</span>
                <span v-if="s.skip" class="flag">{{ t("server.perm.skip") }}</span>
                <span v-if="s.decisive" class="flag win">{{ t("server.perm.decides") }}</span>
              </li>
            </ul>
          </div>
        </li>
      </ul>
    </section>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.close") }}</button>
    </template>
  </AppDialog>
</template>

<style scoped src="../admin/admin.css"></style>
<style scoped>
.toolbar input {
  min-width: 0;
}
.hint {
  margin: 6px 0 10px;
}
.meta {
  color: var(--text-dim);
  font-size: 12px;
}
.cat h3 {
  font-size: 13px;
  margin: 12px 0 6px;
  color: var(--text-dim);
  text-transform: capitalize;
}
.title {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: baseline;
}
code {
  overflow-wrap: anywhere;
  font-weight: 600;
}
.value {
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}
.sources {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.sources li {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 8px;
  color: var(--text-dim);
  overflow-wrap: anywhere;
}
.sources li.decisive {
  color: var(--text);
}
.num {
  font-variant-numeric: tabular-nums;
}
.flag {
  font-size: 11px;
  padding: 0 5px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.flag.win {
  border-color: var(--accent);
  color: var(--accent);
}
</style>
