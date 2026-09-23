<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useTsStore } from "../stores/ts";
import { useHubAccessStore } from "../stores/hubAccess";
import { useI18n } from "../i18n";
import { defaultMusicBot } from "../music/target";
import LanguageSelect from "./LanguageSelect.vue";
import IdentityPicker from "./identity/IdentityPicker.vue";
import BookmarkPicker from "./bookmarks/BookmarkPicker.vue";
import { useIdentitiesStore } from "../stores/identities";
import { applyToProfile, type BookmarkForm } from "../bookmarks/form";
import type { StoredIdentity } from "../identity/book";
import { cleanPrivilegeKey } from "./server/server-rows";
import { cancelRedeemOnConnect, redeemOnConnect } from "./server/redeem-on-connect";

const emit = defineEmits<{ submit: [] }>();
const ts = useTsStore();
const access = useHubAccessStore();
const { t } = useI18n();
const identities = useIdentitiesStore();
const form = reactive({ ...ts.profile, defaultChannelPassword: "" });
/** Set when a bookmark's passwords could not be decrypted (vault key cleared). */
const lostPasswords = ref(false);
const busy = ref(false);
/**
 * A privilege key to redeem once connected (redeem-on-connect.ts). Kept out
 * of the profile and never stored: it is single-use and grants a group.
 */
const privilegeKey = ref("");
/** What the hub dials when the field stays blank. */
const musicBotPlaceholder = computed(() => defaultMusicBot(form.host.trim() || "…"));

// A first visit starts from the hub's suggested server.
if (!localStorage.getItem("jinz.ts.profile") && access.defaultServer) {
  const [h, p] = access.defaultServer.split(":");
  form.host = h ?? form.host;
  form.port = p ? Number(p) : form.port;
}

/** An identity's nickname preset replaces the nickname; one without a preset leaves it. */
function onIdentityPicked(identity: StoredIdentity): void {
  if (identity.nickname) form.nickname = identity.nickname;
}

function onBookmark(b: BookmarkForm, lost: boolean): void {
  Object.assign(form, applyToProfile(form, b));
  lostPasswords.value = lost;
  const identity = identities.byId(b.identityId);
  if (identity) {
    identities.select(identity.id);
    if (!b.nickname) onIdentityPicked(identity);
  }
}

async function submit(): Promise<void> {
  const key = cleanPrivilegeKey(privilegeKey.value);
  if (privilegeKey.value.trim() && !key) return;
  emit("submit");
  if (key) redeemOnConnect(key);
  busy.value = true;
  try {
    await ts.connect({ ...form, host: form.host.trim(), nickname: form.nickname.trim() });
  } catch (err) {
    cancelRedeemOnConnect();
    ts.pushEvent(err instanceof Error ? err.message : String(err), "error");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="overlay">
    <form class="dialog glass" @submit.prevent="submit">
      <div class="head">
        <h2>{{ t("connect.title") }}</h2>
        <LanguageSelect />
      </div>
      <BookmarkPicker
        v-if="!access.fixedServer"
        :current="form"
        :identity-id="identities.active?.id ?? null"
        @apply="onBookmark"
      />
      <p v-if="lostPasswords" class="hint">{{ t("bookmark.lostPasswords") }}</p>
      <label v-if="!access.fixedServer">
        <span>{{ t("connect.host") }}</span>
        <div class="row">
          <input v-model="form.host" placeholder="ts.example.com" required />
          <input v-model.number="form.port" class="port" type="number" min="1" max="65535" />
        </div>
      </label>
      <label>
        <span>{{ t("connect.nickname") }}</span>
        <input v-model="form.nickname" minlength="3" maxlength="30" required autofocus />
      </label>
      <template v-if="!access.fixedServer">
        <label>
          <span>{{ t("connect.serverPassword") }}</span>
          <input v-model="form.serverPassword" type="password" autocomplete="off" />
        </label>
        <label>
          <span>{{ t("connect.defaultChannel") }}</span>
          <input v-model="form.defaultChannel" :placeholder="t('connect.channelPlaceholder')" />
        </label>
        <label v-if="form.defaultChannel.trim()">
          <span>{{ t("bookmark.channelPassword") }}</span>
          <input v-model="form.defaultChannelPassword" type="password" autocomplete="off" />
        </label>
        <label>
          <span>{{ t("connect.musicBot") }}</span>
          <input v-model="form.musicBot" :placeholder="musicBotPlaceholder" autocomplete="off" />
          <p class="hint">{{ t("connect.musicBotHint") }}</p>
        </label>
      </template>
      <details class="more" data-testid="connect-more">
        <summary>{{ t("connect.more") }}</summary>
        <label v-if="access.fixedServer">
          <span>{{ t("connect.defaultChannel") }}</span>
          <input v-model="form.defaultChannel" :placeholder="t('connect.channelPlaceholder')" />
        </label>
        <label>
          <span>{{ t("server.pk.connectLabel") }}</span>
          <input
            v-model="privilegeKey"
            data-testid="connect-privilege-key"
            autocomplete="off"
            spellcheck="false"
          />
          <p v-if="privilegeKey.trim() && !cleanPrivilegeKey(privilegeKey)" class="error">
            {{ t("server.pk.notAKey") }}
          </p>
          <p v-else class="hint">{{ t("server.pk.connectHint") }}</p>
        </label>
      </details>
      <IdentityPicker @picked="onIdentityPicked" />
      <p v-if="ts.lastError" class="error">{{ ts.lastError }}</p>
      <div class="actions">
        <button
          v-if="access.passwordRequired"
          type="button"
          class="ghost"
          @click="access.logout()"
          :title="t('connect.hubLogoutTitle')"
        >
          {{ t("connect.hubLogout") }}
        </button>
        <button
          type="button"
          class="ghost"
          :class="{ active: ts.showLog }"
          @click="ts.showLog = !ts.showLog"
          :title="t('connect.logTitle')"
        >
          {{ t("connect.log") }}
        </button>
        <button type="submit" class="primary" :disabled="busy || ts.connState === 'connecting'">
          {{ ts.connState === "connecting" ? t("connect.connecting") : t("connect.submit") }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.overlay {
  /* Absolute, not fixed: the status bar stays visible below the dock area. */
  position: absolute;
  inset: 0;
  overflow: auto;
  display: grid;
  place-items: center;
  /* A soft glow over whatever page background the theme sets. */
  background: radial-gradient(ellipse at top, rgba(255, 255, 255, 0.045), transparent 70%);
}
.dialog {
  width: min(420px, 92vw);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}
h2 {
  margin: 0;
  font-size: 18px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--text-dim);
  font-size: 12px;
}
label input {
  width: 100%;
}
.row {
  display: flex;
  gap: 8px;
}
.port {
  width: 96px;
  flex: none;
}
.actions {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: white;
  padding: 8px 18px;
}
.ghost {
  background: transparent;
  color: var(--text-dim);
}
.ghost.active {
  color: var(--accent);
  border-color: var(--accent);
}
.actions {
  gap: 8px;
}
.actions button {
  white-space: nowrap;
}
.actions .primary {
  margin-left: auto;
}
.more summary {
  cursor: pointer;
  color: var(--text-dim);
  font-size: 12px;
}
.more label {
  margin-top: 10px;
}
.hint {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 12px;
}

@media (max-width: 768px) {
  .overlay {
    /* Centred vertically, the dialog is pushed off the top once the on-screen
       keyboard shrinks the viewport; anchor it to the top instead. */
    place-items: start center;
    padding: 16px 12px calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .dialog {
    width: 100%;
    padding: 18px 16px;
    gap: 12px;
  }
  .actions {
    flex-direction: column-reverse;
  }
  .actions button {
    width: 100%;
    min-height: 44px;
  }
}
</style>
