<script setup lang="ts">
/**
 * Going away, with an optional message ("back in 10") that others see in the
 * tree's tooltip and the info panel. The presets are this browser's own list:
 * a click fills the field, "+" keeps the current text, "×" drops one.
 */
import { computed, ref } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { useTsStore } from "../../stores/ts";
import { useClientPrefsStore } from "../../stores/clientPrefs";
import { useI18n } from "../../i18n";
import { setAwayStatus } from "../../ts/client-actions";
import { AWAY_MESSAGE_MAX } from "../../ts/client-features";

const emit = defineEmits<{ close: [] }>();
const ts = useTsStore();
const prefs = useClientPrefsStore();
const { t } = useI18n();

const message = ref(ts.selfClient?.awayMessage ?? "");
const busy = ref(false);
const error = ref<string | null>(null);
const isAway = computed(() => ts.selfClient?.away ?? false);
const canKeep = computed(() => {
  const text = message.value.trim();
  return text !== "" && !prefs.awayPresets.includes(text);
});

async function apply(away: boolean): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    await setAwayStatus(away, message.value);
    emit("close");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog
    as="form"
    width="380px"
    :title="t('away.title')"
    :dismissible="!busy"
    @submit="apply(true)"
    @close="emit('close')"
  >
    <FormField
      data-testid="away-dialog"
      v-slot="f"
      :label="t('away.message')"
      :hint="t('away.messageHint')"
      :error="error"
    >
      <div class="with-keep">
        <input
          :id="f.id"
          v-model="message"
          :maxlength="AWAY_MESSAGE_MAX"
          autocomplete="off"
          autofocus
          :aria-describedby="f.describedby"
          :aria-invalid="f.invalid"
        />
        <button
          type="button"
          class="keep"
          :disabled="!canKeep"
          :title="t('away.keepPreset')"
          :aria-label="t('away.keepPreset')"
          @click="prefs.addAwayPreset(message)"
        >
          +
        </button>
      </div>
    </FormField>
    <div class="presets" :aria-label="t('away.presets')">
      <span v-for="p in prefs.awayPresets" :key="p" class="preset">
        <button type="button" class="pick" @click="message = p">{{ p }}</button>
        <button
          type="button"
          class="drop"
          :title="t('away.removePreset')"
          :aria-label="`${t('away.removePreset')}: ${p}`"
          @click="prefs.removeAwayPreset(p)"
        >
          ×
        </button>
      </span>
    </div>
    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button v-if="isAway" type="button" :disabled="busy" @click="apply(false)">
        {{ t("away.back") }}
      </button>
      <button type="submit" class="primary" :disabled="busy">
        {{ isAway ? t("away.update") : t("away.set") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.with-keep {
  display: flex;
  gap: 6px;
}
.with-keep input {
  flex: 1;
  min-width: 0;
}
.keep {
  flex: none;
  width: 34px;
  padding: 0;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preset {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}
.preset button {
  border: none;
  border-radius: 0;
  background: transparent;
  font-size: 12px;
}
.pick {
  padding: 3px 4px 3px 10px;
}
.drop {
  padding: 3px 8px 3px 4px;
  color: var(--text-dim);
}
.preset button:hover {
  background: var(--bg-elev-2);
}
</style>
