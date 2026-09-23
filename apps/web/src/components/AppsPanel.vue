<script setup lang="ts">
/**
 * Dock panel for websites, in two rows:
 *  - the app list: every site on this hub, shared by everyone; click to open,
 *    ＋ to add one, × to remove one for everyone;
 *  - the opened apps: this user's tabs; × only closes the tab here.
 * Below them the showing site, in a sandboxed iframe. Open sites stay mounted
 * (hidden with v-show), so switching tabs does not reload a video or lose a
 * half-filled form.
 *
 * Many sites forbid being framed (X-Frame-Options / CSP frame-ancestors); the
 * browser then shows its own error inside the frame, which a page cannot
 * detect, so an "open in a new tab" link is always there.
 */
import { ref } from "vue";
import { MAX_APP_NAME_LENGTH, type SharedApp } from "@jinz/protocol";
import { useWebAppsStore, type AddAppError } from "../stores/webApps";
import { useI18n, type MessageKey } from "../i18n";
import { confirmDialog } from "./ui/confirm";
import AppIcon from "./apps/AppIcon.vue";
import { MAX_ZOOM, MIN_ZOOM } from "../webapps/zoom";

const store = useWebAppsStore();
const { t } = useI18n();

const adding = ref(false);
const busy = ref(false);
const name = ref("");
const url = ref("");
const error = ref<AddAppError | null>(null);

const ERRORS: Record<AddAppError, MessageKey> = {
  invalid: "apps.errInvalid",
  sameOrigin: "apps.errSameOrigin",
  full: "apps.errFull",
  exists: "apps.errExists",
  failed: "apps.errFailed",
};

function show(app: SharedApp): void {
  store.open(app.id);
  adding.value = false;
}

async function submit(): Promise<void> {
  busy.value = true;
  error.value = await store.add(name.value, url.value);
  busy.value = false;
  if (error.value) return;
  name.value = "";
  url.value = "";
  adding.value = false;
}

async function removeForEveryone(app: SharedApp): Promise<void> {
  const ok = await confirmDialog({
    title: t("apps.removeConfirm", { name: app.name }),
    message: t("apps.removeConfirmHint"),
    confirmLabel: t("dialog.delete"),
    danger: true,
  });
  if (ok) await store.remove(app.id);
}

/**
 * A frame zoomed to z is laid out at 1/z of the panel and scaled back up, so
 * the site gets a viewport of that size and reflows to it.
 */
function frameStyle(app: SharedApp): Record<string, string> | undefined {
  const zoom = store.zoomOf(app.id);
  if (zoom === 1) return undefined;
  return {
    width: `${100 / zoom}%`,
    height: `${100 / zoom}%`,
    transform: `scale(${zoom})`,
  };
}

function tooltip(app: SharedApp): string {
  return app.addedBy ? `${app.url}\n${t("apps.addedBy", { name: app.addedBy })}` : app.url;
}
</script>

<template>
  <div class="apps">
    <!-- Row 1: every site on this hub. -->
    <div class="list" role="toolbar" :aria-label="t('apps.list')">
      <span class="list-label">{{ t("apps.list") }}</span>
      <div
        v-for="app in store.apps"
        :key="app.id"
        class="entry"
        :class="{ open: store.openedApps.some((a) => a.id === app.id) }"
      >
        <button
          type="button"
          class="entry-open"
          :title="tooltip(app)"
          data-testid="apps-entry"
          @click="show(app)"
        >
          <AppIcon :app="app" />
          <span class="entry-name">{{ app.name }}</span>
        </button>
        <button
          type="button"
          class="entry-remove"
          :title="t('apps.remove', { name: app.name })"
          :aria-label="t('apps.remove', { name: app.name })"
          @click="removeForEveryone(app)"
        >
          ×
        </button>
      </div>
      <button
        type="button"
        class="add"
        :class="{ active: adding }"
        :title="t('apps.add')"
        data-testid="apps-add"
        @click="adding = !adding"
      >
        ＋
      </button>
    </div>

    <!-- Row 2: the sites this user has open. -->
    <div v-if="store.openedApps.length" class="tabs" role="tablist">
      <div
        v-for="app in store.openedApps"
        :key="app.id"
        class="tab"
        :class="{ active: !adding && store.active?.id === app.id }"
      >
        <button
          type="button"
          role="tab"
          class="tab-name"
          :aria-selected="!adding && store.active?.id === app.id"
          :title="app.url"
          data-testid="apps-tab"
          @click="show(app)"
        >
          <AppIcon :app="app" />
          <span>{{ app.name }}</span>
        </button>
        <button
          type="button"
          class="tab-close"
          :title="t('apps.close', { name: app.name })"
          :aria-label="t('apps.close', { name: app.name })"
          @click="store.close(app.id)"
        >
          ×
        </button>
      </div>
      <div v-if="store.active && !adding" class="zoom" role="group" :aria-label="t('apps.zoom')">
        <button
          type="button"
          :disabled="store.zoomOf(store.active.id) <= MIN_ZOOM"
          :title="t('apps.zoomOut')"
          :aria-label="t('apps.zoomOut')"
          data-testid="apps-zoom-out"
          @click="store.zoomBy(store.active.id, -1)"
        >
          −
        </button>
        <button
          type="button"
          class="zoom-level"
          :title="t('apps.zoomReset')"
          data-testid="apps-zoom-level"
          @click="store.setZoom(store.active.id, 1)"
        >
          {{ Math.round(store.zoomOf(store.active.id) * 100) }}%
        </button>
        <button
          type="button"
          :disabled="store.zoomOf(store.active.id) >= MAX_ZOOM"
          :title="t('apps.zoomIn')"
          :aria-label="t('apps.zoomIn')"
          data-testid="apps-zoom-in"
          @click="store.zoomBy(store.active.id, 1)"
        >
          +
        </button>
      </div>
      <a
        v-if="store.active && !adding"
        class="external"
        :href="store.active.url"
        target="_blank"
        rel="noopener noreferrer"
        :title="t('apps.openExternal')"
        >↗</a
      >
    </div>

    <form
      v-if="adding || (store.loaded && !store.apps.length)"
      class="form"
      @submit.prevent="submit"
    >
      <p class="hint">{{ t("apps.intro") }}</p>
      <label>
        <span>{{ t("apps.url") }}</span>
        <input
          v-model="url"
          type="text"
          inputmode="url"
          placeholder="https://example.com"
          required
          data-testid="apps-url"
        />
      </label>
      <label>
        <span>{{ t("apps.name") }}</span>
        <input
          v-model="name"
          type="text"
          :maxlength="MAX_APP_NAME_LENGTH"
          data-testid="apps-name"
        />
      </label>
      <p v-if="error" class="error">{{ t(ERRORS[error]) }}</p>
      <div class="actions">
        <button v-if="store.apps.length" type="button" @click="adding = false">
          {{ t("dialog.cancel") }}
        </button>
        <button type="submit" class="primary" :disabled="busy" data-testid="apps-save">
          {{ t("apps.save") }}
        </button>
      </div>
      <p class="hint">{{ t("apps.frameHint") }}</p>
    </form>
    <p v-else-if="!store.active" class="empty">{{ t("apps.pick") }}</p>

    <div v-show="!adding && store.active" class="frames">
      <iframe
        v-for="app in store.openedApps"
        v-show="store.active?.id === app.id"
        :key="app.id"
        :src="app.url"
        :title="app.name"
        :style="frameStyle(app)"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads"
        allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
        allowfullscreen
        referrerpolicy="no-referrer"
      ></iframe>
    </div>
  </div>
</template>

<style scoped>
.apps {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.list,
.tabs {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  overflow-x: auto;
  scrollbar-width: none;
}
.list {
  background: var(--bg-elev);
}
.list-label {
  flex: none;
  padding: 0 4px;
  font-size: 11px;
  color: var(--text-dim);
  opacity: 0.8;
}
.entry,
.tab {
  flex: none;
  display: flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
}
.entry:hover,
.tab:hover {
  border-color: var(--border);
}
.entry.open .entry-name {
  color: var(--text);
}
.tab.active {
  border-color: var(--border);
  background: var(--bg-elev-2);
  box-shadow: inset 0 -2px 0 var(--accent);
}
.entry-open,
.tab-name,
.entry-remove,
.tab-close,
.add,
.external {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.entry-name,
.tab-name span {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tab.active .tab-name {
  color: var(--text);
}
.entry-remove,
.tab-close {
  padding: 2px 6px 2px 0;
  opacity: 0;
}
/* Removing is for everyone, so it only shows on the entry being pointed at. */
.entry:hover .entry-remove,
.entry:focus-within .entry-remove,
.tab-close {
  opacity: 0.6;
}
.entry-remove:hover,
.tab-close:hover {
  opacity: 1;
  color: var(--danger);
}
.add.active {
  color: var(--accent);
}
.zoom {
  margin-left: auto;
  flex: none;
  display: flex;
  align-items: center;
}
.zoom button {
  border: none;
  background: transparent;
  padding: 2px 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.zoom button:hover:not(:disabled) {
  color: var(--text);
}
.zoom-level {
  min-width: 44px;
  font-variant-numeric: tabular-nums;
}
.external {
  text-decoration: none;
}
.form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  max-width: 460px;
  overflow-y: auto;
}
.form label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
.hint,
.empty {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
}
.empty {
  padding: 16px;
  font-size: 12px;
}
.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.frames {
  flex: 1;
  min-height: 0;
  position: relative;
}
iframe {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
  width: 100%;
  height: 100%;
  border: none;
  /* Most sites assume a white page; without this a transparent one shows the theme through. */
  background: white;
}
</style>
