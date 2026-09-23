<script setup lang="ts">
/**
 * The channel description: a BBCode editor with a small toolbar and a live
 * preview drawn by the same renderer as the info panel, so what you see
 * here is what everyone sees there.
 */
import { nextTick, ref } from "vue";
import FormField from "../ui/FormField.vue";
import { useI18n, type MessageKey } from "../../i18n";
import { renderBBCode } from "../../ts/assets";
import { wrapSelection } from "../../ts/bbcode-edit";
import { CHANNEL_DESCRIPTION_MAX } from "../../ts/channel-form";
import { onRichClick } from "../../chat/richClick";
import "../../chat/bbcode.css";
import type { ChannelFormState } from "./useChannelForm";

const props = defineProps<{ state: ChannelFormState }>();
const { t } = useI18n();
const form = props.state.form;
const v = form.values;
const area = ref<HTMLTextAreaElement | null>(null);

interface Tool {
  label: MessageKey;
  glyph: string;
  open: string;
  close: string;
}

const TOOLS: readonly Tool[] = [
  { label: "chm.bbBold", glyph: "B", open: "[b]", close: "[/b]" },
  { label: "chm.bbItalic", glyph: "I", open: "[i]", close: "[/i]" },
  { label: "chm.bbUnderline", glyph: "U", open: "[u]", close: "[/u]" },
  { label: "chm.bbStrike", glyph: "S", open: "[s]", close: "[/s]" },
  { label: "chm.bbColor", glyph: "🎨", open: "[color=#e06c75]", close: "[/color]" },
  { label: "chm.bbLink", glyph: "🔗", open: "[url]", close: "[/url]" },
  { label: "chm.bbImage", glyph: "🖼", open: "[img]", close: "[/img]" },
  { label: "chm.bbCenter", glyph: "≡", open: "[center]", close: "[/center]" },
];

function apply(tool: Tool): void {
  const el = area.value;
  if (!el) return;
  const out = wrapSelection(
    v.description,
    el.selectionStart,
    el.selectionEnd,
    tool.open,
    tool.close,
  );
  v.description = out.text;
  void nextTick(() => {
    el.focus();
    el.setSelectionRange(out.start, out.end);
  });
}
</script>

<template>
  <p v-if="!state.descLoaded.value" class="loading">{{ t("chm.descLoading") }}</p>
  <template v-else>
    <div class="toolbar">
      <button
        v-for="tool in TOOLS"
        :key="tool.open"
        type="button"
        class="tool"
        :title="t(tool.label)"
        :aria-label="t(tool.label)"
        @click="apply(tool)"
      >
        {{ tool.glyph }}
      </button>
    </div>
    <FormField
      v-slot="f"
      :label="t('chm.description')"
      :hint="`${[...v.description].length} / ${CHANNEL_DESCRIPTION_MAX}`"
      :error="form.errors.description"
    >
      <textarea
        :id="f.id"
        ref="area"
        v-model="v.description"
        name="channel-description"
        rows="6"
        :maxlength="CHANNEL_DESCRIPTION_MAX"
        :aria-describedby="f.describedby"
      ></textarea>
    </FormField>
    <div class="label">{{ t("chm.preview") }}</div>
    <div
      v-if="v.description.trim()"
      class="preview rich bb-rich"
      data-testid="channel-description-preview"
      @click="onRichClick"
      v-html="renderBBCode(v.description)"
    ></div>
    <p v-else class="preview empty">{{ t("chm.previewEmpty") }}</p>
  </template>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.tool {
  min-width: 30px;
  padding: 2px 6px;
  font-weight: 600;
}
textarea {
  resize: vertical;
  font: inherit;
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
.label {
  color: var(--text-dim);
  font-size: 12px;
}
.preview {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  max-height: 180px;
  overflow: auto;
  overflow-wrap: anywhere;
}
.preview.empty,
.loading {
  color: var(--text-dim);
  margin: 0;
}
</style>
