<script setup lang="ts">
/**
 * Ban someone: a rule on UID / IP / nickname pattern (`banadd`), which for
 * a client in `clientId` starts from its UID, or that client as TeamSpeak's
 * own "ban client" does (`banclient`: its UID and its IP).
 *
 * The UID rule is the default on purpose: every web user reaches TeamSpeak
 * through the hub, so they all share one IP, and `banclient`'s IP half would
 * lock every one of them out. That option says so when picked.
 *
 * The client is pinned by UID at open (useTargetClient): if they leave, the
 * dialog falls back to their UID rule rather than following their id to
 * whoever joins next.
 *
 * The hub refuses more on top (commands.ts banRefusal): `banclient` on
 * another web user, an IP rule on the hub's own address, an IP that is not
 * one literal address, a nickname rule that matches almost anyone or could
 * backtrack for ever. The last two are checked here already, under their
 * fields; the hub's refusal of the others shows above the buttons.
 *
 * With `edit` it replaces an existing ban (TS3 has no `banedit`, see
 * ban-actions.ts); when only the new half of that succeeds, `done` carries a
 * warning and the dialog closes, since a retry would add yet another ban.
 * Durations over `i_client_ban_max_bantime`, when the server told us that
 * limit, cannot be picked; an existing ban already longer than that keeps its
 * duration and says why it cannot be saved as is. The server decides the
 * rest, and its refusal is shown above the buttons.
 */
import { computed, watch } from "vue";
import AppDialog from "../ui/AppDialog.vue";
import FormField from "../ui/FormField.vue";
import { rules, useForm } from "../../composables/useForm";
import { useTsStore } from "../../stores/ts";
import { usePermsStore } from "../../stores/perms";
import { useI18n } from "../../i18n";
import { useTargetClient } from "../../composables/useTargetClient";
import { BanEditPartialError, addBan, banClient, editBan } from "../../ts/ban-actions";
import {
  BAN_PRESETS,
  BAN_UNITS,
  CUSTOM_DURATION,
  allowsBanTime,
  chosenSeconds,
  clampBanTime,
  durationParts,
  formatBanDuration,
  maxBanTime,
  nicknamePattern,
  ruleProblem,
  type BanEntry,
  type BanUnit,
} from "../../ts/bans";

const REASON_MAX = 80;

const props = defineProps<{ clientId?: number; edit?: BanEntry }>();
const emit = defineEmits<{ close: []; done: [warning?: string] }>();
const ts = useTsStore();
const perms = usePermsStore();
const { t } = useI18n();

const target =
  props.clientId === undefined ? computed(() => null) : useTargetClient(ts.clients, props.clientId);
/** Who the dialog opened for, kept for the title once they are gone. */
const openedFor = target.value?.nickname ?? null;
const cap = computed(() => maxBanTime(perms.values, perms.loaded));
const units = Object.keys(BAN_UNITS) as BanUnit[];
const dur = (s: number) => formatBanDuration(s, t);

/** The select's value and the custom amount for `seconds`. */
function durationChoice(seconds: number) {
  // A new ban's default fits under the cap; an existing ban keeps what it has.
  const s = props.edit ? seconds : clampBanTime(seconds, cap.value);
  if (BAN_PRESETS.includes(s)) return { choice: String(s), amount: 1, unit: "d" as BanUnit };
  return { choice: CUSTOM_DURATION, ...durationParts(s) };
}

type Values = {
  mode: "client" | "rule";
  uid: string;
  ip: string;
  name: string;
  choice: string;
  amount: number;
  unit: BanUnit;
  reason: string;
};

const seconds = (v: Values) => chosenSeconds(v.choice, v.amount, v.unit);
const hasRule = (v: Values) => !!(v.uid.trim() || v.ip.trim() || v.name.trim());
/** Set by a half-done edit, passed on with `done`. */
let partial: string | null = null;

const form = useForm<Values>({
  initial: () => ({
    // Never `banclient` by default: see the file comment.
    mode: "rule",
    uid: props.edit?.uid ?? target.value?.uid ?? "",
    ip: props.edit?.ip ?? "",
    name: props.edit?.name ?? "",
    reason: props.edit?.reason ?? "",
    ...durationChoice(props.edit?.duration ?? BAN_PRESETS[0]!),
  }),
  rules: {
    uid: (_v, all) => all.mode === "rule" && !hasRule(all) && t("ban.ruleEmpty"),
    ip: (v, all) => {
      const problem = all.mode === "rule" ? ruleProblem("ip", v) : null;
      return problem && t(problem);
    },
    name: (v, all) => {
      const problem = all.mode === "rule" ? ruleProblem("name", v) : null;
      return problem && t(problem);
    },
    amount: (_v, all) => {
      const s = seconds(all);
      if (s === null) return t("ban.amountInvalid");
      return !allowsBanTime(s, cap.value) && t("ban.overMax", { time: dur(cap.value ?? 0) });
    },
    reason: rules.maxLength(REASON_MAX),
  },
  onSubmit: async (v) => {
    const time = seconds(v) ?? 0;
    const rule = { uid: v.uid, ip: v.ip, name: v.name };
    partial = null;
    try {
      if (v.mode === "client") {
        if (!target.value) return t("tsErr.invalidClient");
        await banClient(target.value.id, time, v.reason);
      } else if (props.edit) {
        await editBan(props.edit, rule, time, v.reason);
      } else {
        await addBan(rule, time, v.reason);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!(err instanceof BanEditPartialError)) return msg;
      // Both bans stand now; closing keeps a retry from adding a third.
      partial = t("ban.editPartial", { msg });
    }
  },
});

/** The ban being edited runs longer than we may ban for: saving needs a shorter one. */
const editOverCap = computed(() =>
  props.edit && !allowsBanTime(props.edit.duration, cap.value) ? cap.value : null,
);

// They left: `banclient` has nobody to act on, so fall back to the UID rule.
const gone = computed(() => openedFor !== null && !target.value);
watch([gone, form.submitting], ([isGone, busy]) => {
  if (isGone && !busy) form.values.mode = "rule";
});

const title = computed(() => {
  if (props.edit) return t("ban.editTitle");
  const name = target.value?.nickname ?? openedFor;
  return name !== null ? t("ban.title", { name }) : t("ban.addTitle");
});

function matchNickname(): void {
  const name = target.value?.nickname ?? openedFor;
  if (name !== null) form.values.name = nicknamePattern(name);
}

async function submit(): Promise<void> {
  if (await form.submit()) {
    emit("done", partial ?? undefined);
    emit("close");
  }
}
</script>

<template>
  <AppDialog
    as="form"
    width="440px"
    :title="title"
    :dismissible="!form.submitting.value"
    danger
    @submit="submit"
    @close="emit('close')"
  >
    <div v-if="target && !edit" class="modes" role="radiogroup">
      <label>
        <input v-model="form.values.mode" type="radio" value="rule" />
        {{ t("ban.modeRule") }}
      </label>
      <label>
        <input v-model="form.values.mode" type="radio" value="client" />
        {{ t("ban.modeClient") }}
      </label>
      <p v-if="form.values.mode === 'client'" class="note warn">{{ t("ban.ipWarning") }}</p>
    </div>

    <p v-if="gone" class="note warn" role="status" data-testid="ban-target-left">
      {{ t("ban.targetLeft", { name: openedFor ?? "" }) }}
    </p>

    <template v-if="form.values.mode === 'rule'">
      <FormField v-slot="f" :label="t('ban.uid')" :error="form.errors.uid">
        <input
          :id="f.id"
          v-model="form.values.uid"
          name="uid"
          maxlength="64"
          autocomplete="off"
          :aria-describedby="f.describedby"
          :aria-invalid="f.invalid"
        />
      </FormField>
      <FormField v-slot="f" :label="t('ban.ip')" :error="form.errors.ip">
        <input
          :id="f.id"
          v-model="form.values.ip"
          name="ip"
          maxlength="64"
          autocomplete="off"
          :aria-describedby="f.describedby"
          :aria-invalid="f.invalid"
          @blur="form.touch('ip')"
        />
      </FormField>
      <FormField
        v-slot="f"
        :label="t('ban.name')"
        :hint="t('ban.nameHint')"
        :error="form.errors.name"
      >
        <div class="row">
          <input
            :id="f.id"
            v-model="form.values.name"
            name="name"
            maxlength="100"
            autocomplete="off"
            :aria-describedby="f.describedby"
            :aria-invalid="f.invalid"
            @blur="form.touch('name')"
          />
          <button v-if="openedFor !== null" type="button" class="small" @click="matchNickname">
            {{ t("ban.matchNickname") }}
          </button>
        </div>
      </FormField>
    </template>

    <FormField
      v-slot="f"
      :label="t('ban.duration')"
      :hint="cap ? t('ban.maxHint', { time: dur(cap) }) : undefined"
      :error="form.errors.amount"
    >
      <div class="row">
        <select
          :id="f.id"
          v-model="form.values.choice"
          name="duration"
          :aria-describedby="f.describedby"
        >
          <option
            v-for="p in BAN_PRESETS"
            :key="p"
            :value="String(p)"
            :disabled="!allowsBanTime(p, cap)"
          >
            {{ dur(p) }}
          </option>
          <option :value="CUSTOM_DURATION">{{ t("ban.custom") }}</option>
        </select>
        <template v-if="form.values.choice === CUSTOM_DURATION">
          <input
            v-model.number="form.values.amount"
            name="amount"
            type="number"
            min="1"
            step="1"
            class="amount"
            :aria-label="t('ban.amount')"
            :aria-invalid="f.invalid"
          />
          <select v-model="form.values.unit" name="unit" :aria-label="t('ban.unit')">
            <option v-for="u in units" :key="u" :value="u">{{ t(`ban.unit.${u}`) }}</option>
          </select>
        </template>
      </div>
    </FormField>

    <FormField
      v-slot="f"
      data-testid="ban-dialog"
      :label="t('ban.reason')"
      :error="form.errors.reason"
    >
      <input
        :id="f.id"
        v-model="form.values.reason"
        name="reason"
        :maxlength="REASON_MAX"
        autocomplete="off"
        :aria-describedby="f.describedby"
        :aria-invalid="f.invalid"
      />
    </FormField>

    <p v-if="edit" class="note">{{ t("ban.editHint") }}</p>
    <p v-if="editOverCap !== null" class="note warn">
      {{ t("ban.editOverMax", { time: dur(editOverCap) }) }}
    </p>
    <p v-if="form.formError.value" class="note error" role="alert">{{ form.formError.value }}</p>

    <template #footer>
      <button type="button" @click="emit('close')">{{ t("dialog.cancel") }}</button>
      <button type="submit" class="danger" :disabled="form.submitting.value">
        {{ edit ? t("ban.save") : t("ban.submit") }}
      </button>
    </template>
  </AppDialog>
</template>

<style scoped>
.modes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}
.modes label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
}
.row > input:not(.amount),
.row > select:first-child {
  flex: 1;
  min-width: 0;
}
.amount {
  width: 80px;
}
.small {
  flex: none;
  font-size: 12px;
}
.note {
  margin: 0;
  color: var(--text-dim);
  font-size: 12px;
}
.note.error {
  color: var(--danger);
}
.note.warn {
  flex-basis: 100%;
  color: var(--warn);
}
</style>
