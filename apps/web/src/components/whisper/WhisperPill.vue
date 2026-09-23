<script setup lang="ts">
/**
 * Shown while the whisper key is held: who this whisper really reaches, as
 * the hub accepted it, so nobody whispers into the void (or to more people
 * than they meant) without noticing.
 *
 * Without whisper power the server may drop the whisper for everyone on that
 * list, silently (whisper-power.ts), so the pill says that too. It only says:
 * the key keeps working, since a server that asks no whisper power of anyone
 * still lets the whisper through.
 */
import { computed } from "vue";
import { useI18n } from "../../i18n";
import { useVoiceStore } from "../../stores/voice";
import { usePermsStore } from "../../stores/perms";
import { lacksWhisperPower } from "./whisper-power";

const { t } = useI18n();
const voice = useVoiceStore();
const perms = usePermsStore();

const target = computed(() => (voice.whisperPressed ? voice.whisperTarget : null));

const label = computed(() => {
  const tg = target.value;
  if (!tg) return "";
  if (tg.channels.length + tg.clients.length === 0) return t("whisper.pillNone");
  const line = t("whisper.pill", { channels: tg.channels.length, clients: tg.clients.length });
  return tg.truncated ? `${line} ${t("whisper.pillTruncated")}` : line;
});

const powerless = computed(() => lacksWhisperPower(perms.values, perms.loaded));
</script>

<template>
  <span
    v-if="target"
    class="whisper-pill"
    :class="{ empty: target.channels.length + target.clients.length === 0, powerless }"
    role="status"
    data-testid="whisper-pill"
    :title="powerless ? t('whisper.noPowerHint') : undefined"
    >{{ label
    }}<span v-if="powerless" class="no-power" data-testid="whisper-power-hint">
      · ⚠ {{ t("whisper.noPower") }}</span
    ></span
  >
</template>

<style scoped>
.whisper-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 12px;
  white-space: nowrap;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  border: 1px solid currentColor;
}
.whisper-pill.empty {
  color: var(--warn);
  background: transparent;
}
/* The whisper itself still goes out; only the warning is in the warning colour. */
.whisper-pill.powerless {
  border-color: var(--warn);
}
.no-power {
  color: var(--warn);
  white-space: pre;
}
</style>
