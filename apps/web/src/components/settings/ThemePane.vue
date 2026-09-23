<script setup lang="ts">
import { computed, ref } from "vue";
import { useThemeStore } from "../../stores/theme";
import { useI18n } from "../../i18n";
import {
  BLUR_MAX,
  MAX_CUSTOM_CSS,
  OPACITY_MIN,
  PRESETS,
  SKINS,
  backgroundCss,
  overriddenVariables,
  themeToCss,
  type BackgroundKind,
  type SkinId,
  type Theme,
} from "../../theme/theme";

const store = useThemeStore();
const { t } = useI18n();
const tab = ref<"look" | "code">("look");

const theme = computed(() => store.theme);
const bg = computed(() => theme.value.background);
const isGradient = computed(() => bg.value.kind !== "solid");

const KINDS: {
  kind: BackgroundKind;
  label: "theme.bgSolid" | "theme.bgLinear" | "theme.bgRadial";
}[] = [
  { kind: "solid", label: "theme.bgSolid" },
  { kind: "linear", label: "theme.bgLinear" },
  { kind: "radial", label: "theme.bgRadial" },
];

function patchBackground(patch: Partial<Theme["background"]>): void {
  store.update((cur) => ({ ...cur, background: { ...cur.background, ...patch } }));
}
function patchSurface(patch: Partial<Theme["surface"]>): void {
  store.update((cur) => ({ ...cur, surface: { ...cur.surface, ...patch } }));
}
function patchGlass(patch: Partial<Theme["glass"]>): void {
  store.update((cur) => ({ ...cur, glass: { ...cur.glass, ...patch } }));
}

function setStop(index: number, color: string): void {
  patchBackground({ stops: bg.value.stops.map((c, i) => (i === index ? color : c)) });
}
function addStop(): void {
  patchBackground({ stops: [...bg.value.stops, bg.value.stops.at(-1)!] });
}
function removeStop(): void {
  patchBackground({ stops: bg.value.stops.slice(0, -1) });
}

/** Reads a form control's value; the store validates whatever comes out. */
function value(ev: Event): string {
  return (ev.target as HTMLInputElement).value;
}
function numberValue(ev: Event): number {
  return Number(value(ev));
}

const customCss = computed({
  get: () => theme.value.customCss,
  set: (css: string) => store.update((cur) => ({ ...cur, customCss: css })),
});

/** Look controls the hand-written CSS overrides; they would otherwise seem broken. */
const overridden = computed(() => overriddenVariables(theme.value.customCss));

/** Starts the code from what the sliders produce, so there is something to edit. */
function insertVars(): void {
  const generated = themeToCss({ ...theme.value, customCss: "" });
  customCss.value = customCss.value ? `${generated}\n${customCss.value}` : generated;
}

/** Tab indents inside the editor instead of leaving it. */
function onCodeKey(ev: KeyboardEvent): void {
  if (ev.key !== "Tab" || ev.shiftKey) return;
  ev.preventDefault();
  const el = ev.target as HTMLTextAreaElement;
  const { selectionStart: start, selectionEnd: end } = el;
  customCss.value = `${el.value.slice(0, start)}  ${el.value.slice(end)}`;
  requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
}
</script>

<template>
  <div class="pane">
    <div class="tabs" role="tablist">
      <button role="tab" :class="{ active: tab === 'look' }" @click="tab = 'look'">
        {{ t("theme.tabLook") }}
      </button>
      <button role="tab" :class="{ active: tab === 'code' }" @click="tab = 'code'">
        {{ t("theme.tabCode") }}
      </button>
      <button class="small reset" @click="store.reset()">{{ t("theme.reset") }}</button>
    </div>

    <template v-if="tab === 'look'">
      <p v-if="overridden.length" class="hint warn">
        {{ t("theme.overridden", { vars: overridden.join(", ") }) }}
      </p>
      <section>
        <div class="label">{{ t("theme.presets") }}</div>
        <div class="presets">
          <button
            v-for="p in PRESETS"
            :key="p.id"
            class="preset"
            :title="t(p.label)"
            @click="store.applyPreset(p.id)"
          >
            <span class="swatch" :style="{ background: backgroundCss(p.theme.background) }"></span>
            <span class="preset-name">{{ t(p.label) }}</span>
          </button>
        </div>
      </section>

      <section>
        <div class="label">{{ t("theme.background") }}</div>
        <div class="segmented">
          <button
            v-for="k in KINDS"
            :key="k.kind"
            :class="{ active: bg.kind === k.kind }"
            @click="patchBackground({ kind: k.kind })"
          >
            {{ t(k.label) }}
          </button>
        </div>
        <label v-if="!isGradient" class="row">
          <span>{{ t("theme.color") }}</span>
          <input
            type="color"
            :value="bg.color"
            @input="patchBackground({ color: value($event) })"
          />
        </label>
        <template v-else>
          <div class="row">
            <span>{{ t("theme.stops") }}</span>
            <span class="stops">
              <input
                v-for="(c, i) in bg.stops"
                :key="i"
                type="color"
                :value="c"
                @input="setStop(i, value($event))"
              />
              <button
                v-if="bg.stops.length < 3"
                class="small"
                :title="t('theme.addStop')"
                @click="addStop"
              >
                +
              </button>
              <button v-else class="small" :title="t('theme.removeStop')" @click="removeStop">
                −
              </button>
            </span>
          </div>
          <label v-if="bg.kind === 'linear'" class="col">
            <span>{{ t("theme.angle", { deg: bg.angle }) }}</span>
            <input
              type="range"
              min="0"
              max="360"
              step="5"
              :value="bg.angle"
              @input="patchBackground({ angle: numberValue($event) })"
            />
          </label>
        </template>
      </section>

      <section>
        <label class="row">
          <span>{{ t("theme.surface") }}</span>
          <input
            type="color"
            :value="theme.surface.color"
            @input="patchSurface({ color: value($event) })"
          />
        </label>
        <label class="col">
          <span>{{ t("theme.opacity", { pct: Math.round(theme.surface.opacity * 100) }) }}</span>
          <input
            type="range"
            :min="OPACITY_MIN"
            max="1"
            step="0.05"
            :value="theme.surface.opacity"
            @input="patchSurface({ opacity: numberValue($event) })"
          />
        </label>
      </section>

      <section>
        <label class="row">
          <span>{{ t("theme.glass") }}</span>
          <input
            type="checkbox"
            :checked="theme.glass.enabled"
            @change="patchGlass({ enabled: ($event.target as HTMLInputElement).checked })"
          />
        </label>
        <template v-if="theme.glass.enabled">
          <label class="col">
            <span>{{ t("theme.blur", { px: theme.glass.blur }) }}</span>
            <input
              type="range"
              min="0"
              :max="BLUR_MAX"
              step="1"
              :value="theme.glass.blur"
              @input="patchGlass({ blur: numberValue($event) })"
            />
          </label>
          <p v-if="theme.surface.opacity >= 1" class="hint">{{ t("theme.glassHint") }}</p>
        </template>
      </section>

      <label class="row">
        <span>{{ t("theme.skin") }}</span>
        <select
          :value="theme.skin"
          @change="store.update((cur) => ({ ...cur, skin: value($event) as SkinId }))"
        >
          <option v-for="s in SKINS" :key="s.id" :value="s.id">{{ t(s.label) }}</option>
        </select>
      </label>

      <label class="row">
        <span>{{ t("theme.accent") }}</span>
        <input
          type="color"
          :value="theme.accent"
          @input="store.update((cur) => ({ ...cur, accent: value($event) }))"
        />
      </label>
    </template>

    <template v-else>
      <p v-if="store.safeMode" class="hint warn">{{ t("theme.safeMode") }}</p>
      <p class="hint">{{ t("theme.codeHint") }}</p>
      <textarea
        v-model="customCss"
        class="code"
        spellcheck="false"
        autocapitalize="off"
        autocomplete="off"
        :maxlength="MAX_CUSTOM_CSS"
        placeholder=":root {&#10;  --app-bg: linear-gradient(120deg, #1d2b64, #f8cdda);&#10;  --accent: #ff7ab6;&#10;}"
        @keydown="onCodeKey"
      ></textarea>
      <div class="row">
        <span class="counter">
          {{ t("theme.codeChars", { n: customCss.length, max: MAX_CUSTOM_CSS }) }}
        </span>
        <span class="actions">
          <button class="small" @click="insertVars">{{ t("theme.insertVars") }}</button>
          <button class="small" :disabled="!customCss" @click="customCss = ''">
            {{ t("theme.clearCode") }}
          </button>
        </span>
      </div>
      <p class="hint">{{ t("theme.codeSafeHint") }}</p>
    </template>
  </div>
</template>

<style scoped>
.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.label {
  font-size: 12px;
  color: var(--text-dim);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.col {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-dim);
}
.tabs,
.segmented {
  display: flex;
  gap: 4px;
}
.tabs > button:not(.reset),
.segmented > button {
  flex: 1;
  padding: 4px 6px;
  font-size: 12px;
}
.tabs > button.active,
.segmented > button.active {
  border-color: var(--accent);
  color: var(--accent);
}
.presets {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
  gap: 6px;
}
.preset {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px;
  font-size: 11px;
}
.swatch {
  width: 100%;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border);
}
.preset-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stops,
.actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
input[type="color"] {
  width: 36px;
  height: 26px;
  padding: 2px;
  cursor: pointer;
}
.row select {
  max-width: 200px;
}
input[type="checkbox"] {
  width: auto;
}
input[type="range"] {
  width: 100%;
  padding: 0;
}
.small {
  padding: 3px 8px;
  font-size: 12px;
}
.code {
  width: 100%;
  min-height: 200px;
  resize: vertical;
  font-family: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre;
  tab-size: 2;
}
.counter {
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.hint.warn {
  color: var(--warn);
}
</style>
