<script setup lang="ts">
/**
 * Codec and quality. Only the Opus codecs can be chosen: the server refuses
 * the legacy ones, and the web client cannot talk in them. A channel still
 * on Speex / CELT shows that as a read-only choice until Opus is picked.
 */
import { computed } from "vue";
import FormField from "../ui/FormField.vue";
import { useI18n } from "../../i18n";
import { Codec } from "@jinz/protocol";
import { isSendableCodec, QUALITY_MAX } from "../../ts/channel-form";
import type { ChannelFormState } from "./useChannelForm";

const props = defineProps<{ state: ChannelFormState }>();
const { t } = useI18n();
const form = props.state.form;
const v = form.values;

const LEGACY_NAMES: Record<number, string> = {
  [Codec.SpeexNarrowband]: "Speex Narrowband",
  [Codec.SpeexWideband]: "Speex Wideband",
  [Codec.SpeexUltraWideband]: "Speex Ultra-Wideband",
  [Codec.CeltMono]: "CELT Mono",
};

const legacy = computed(() =>
  isSendableCodec(v.codec) ? null : (LEGACY_NAMES[v.codec] ?? `#${v.codec}`),
);
const maxQuality = props.state.perms.maxQuality();
</script>

<template>
  <FormField
    v-slot="f"
    :label="t('chm.codec')"
    :hint="legacy ? t('chm.codecLegacyHint') : undefined"
    :error="form.errors.codec"
  >
    <select
      :id="f.id"
      v-model.number="v.codec"
      name="channel-codec"
      :aria-describedby="f.describedby"
    >
      <option v-if="legacy" :value="v.codec" disabled>
        {{ t("chm.codecLegacy", { name: legacy }) }}
      </option>
      <option :value="Codec.OpusVoice">{{ t("chm.codecOpusVoice") }}</option>
      <option :value="Codec.OpusMusic">{{ t("chm.codecOpusMusic") }}</option>
    </select>
  </FormField>
  <FormField
    v-slot="f"
    :label="t('chm.quality', { n: v.quality })"
    :hint="maxQuality < QUALITY_MAX ? t('chm.qualityMax', { n: maxQuality }) : t('chm.qualityHint')"
    :error="form.errors.quality"
  >
    <input
      :id="f.id"
      v-model.number="v.quality"
      name="channel-quality"
      type="range"
      min="0"
      :max="Math.max(maxQuality, v.quality)"
      step="1"
      :aria-describedby="f.describedby"
    />
  </FormField>
</template>
