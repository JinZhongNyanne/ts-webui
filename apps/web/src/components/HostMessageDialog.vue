<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useHostMessageStore } from "../stores/hostMessage";
import { renderBBCode } from "../ts/assets";
import { onRichClick } from "../chat/richClick";
import { useI18n } from "../i18n";
import "../chat/bbcode.css";

/**
 * The server's host message as a dialog (`virtualserver_hostmessage_mode` 2
 * and 3). Kept local and minimal; mounted once at the app root so it outlives
 * the connected layout — in mode 3 we are already disconnected when it shows.
 */
const store = useHostMessageStore();
const { t } = useI18n();
const ok = ref<HTMLButtonElement | null>(null);

function onWindowKey(ev: KeyboardEvent): void {
  if (ev.key === "Escape" && store.dialog) store.dismiss();
}

onMounted(() => window.addEventListener("keydown", onWindowKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onWindowKey));

// Focus the button so Enter dismisses, like a native message box.
watch(
  () => store.dialog,
  (d) => {
    if (d) requestAnimationFrame(() => ok.value?.focus());
  },
);
</script>

<template>
  <teleport to="body">
    <div v-if="store.dialog" class="hm-overlay" @click.self="store.dismiss()">
      <div
        class="hm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="hm-title"
        data-testid="host-message"
      >
        <h3 id="hm-title">
          {{ t("hostMessage.title", { server: store.dialog.serverName || t("tree.server") }) }}
        </h3>
        <div
          v-if="store.dialog.text"
          class="hm-body bb-rich"
          @click="onRichClick"
          v-html="renderBBCode(store.dialog.text)"
        ></div>
        <p v-if="store.dialog.disconnected" class="hm-note">{{ t("hostMessage.disconnected") }}</p>
        <div class="hm-actions">
          <button ref="ok" type="button" class="primary" @click="store.dismiss()">
            {{ t("hostMessage.ok") }}
          </button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.hm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: grid;
  place-items: center;
  z-index: 20;
}
.hm-dialog {
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 18px;
  width: min(460px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.hm-dialog h3 {
  margin: 0;
}
.hm-body {
  overflow: auto;
  word-break: break-word;
  line-height: 1.5;
}
.hm-note {
  margin: 0;
  color: var(--warn);
  font-size: 13px;
}
.hm-actions {
  display: flex;
  justify-content: flex-end;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
}
</style>
