/**
 * State behind the create / edit channel dialog: the form (useForm over the
 * pure rules in ts/channel-form.ts), which tab is showing, the description
 * that has to be fetched before it can be edited, and the submit that sends
 * only what changed and puts the server's refusal next to the field it is
 * about.
 */
import { computed, ref, shallowRef, watch } from "vue";
import { useForm } from "../../composables/useForm";
import { useI18n, type MessageKey } from "../../i18n";
import { usePermsStore } from "../../stores/perms";
import { useTsStore } from "../../stores/ts";
import { createChannel, editChannel, setChannelIcon } from "../../ts/channel-actions";
import {
  channelFormRules,
  channelType,
  createArgs,
  editArgs,
  formFromChannel,
  iconChange,
  lastSiblingId,
  newChannelForm,
  orderChoices,
  type ChannelFormValues,
  type ChannelType,
} from "../../ts/channel-form";
import { channelPerms } from "../../ts/channel-perms";
import { createdChannel, fieldOfError } from "../../ts/channel-submit";
import type { ChannelFormDialog } from "./channel-dialogs";

export type ChannelTab = "basics" | "description" | "audio" | "limits" | "advanced";

export const CHANNEL_TABS: readonly { id: ChannelTab; label: MessageKey }[] = [
  { id: "basics", label: "chm.tabBasics" },
  { id: "description", label: "chm.tabDescription" },
  { id: "audio", label: "chm.tabAudio" },
  { id: "limits", label: "chm.tabLimits" },
  { id: "advanced", label: "chm.tabAdvanced" },
];

const TAB_OF: Record<keyof ChannelFormValues, ChannelTab> = {
  name: "basics",
  namePhonetic: "basics",
  topic: "basics",
  hasPassword: "basics",
  password: "basics",
  description: "description",
  codec: "audio",
  quality: "audio",
  maxClientsLimited: "limits",
  maxClients: "limits",
  familyMode: "limits",
  maxFamilyClients: "limits",
  type: "advanced",
  isDefault: "advanced",
  neededTalkPower: "advanced",
  order: "advanced",
  iconId: "advanced",
  deleteDelay: "advanced",
};

const TYPE_PREFERENCE: readonly ChannelType[] = ["permanent", "semi", "temporary"];
const RANK: Record<ChannelType, number> = { temporary: 0, semi: 1, permanent: 2 };

export function useChannelForm(dialog: ChannelFormDialog, onDone: () => void) {
  const ts = useTsStore();
  const perms = usePermsStore();
  const { t } = useI18n();
  const cp = channelPerms(perms);

  const editing = dialog.kind === "edit";
  const cid = dialog.kind === "edit" ? dialog.channelId : null;
  const channel = computed(() => (cid ? (ts.channels.get(cid) ?? null) : null));
  const parentId = channel.value?.parentId ?? (dialog.kind === "create" ? dialog.parentId : "0");
  const parent = ts.channels.get(parentId) ?? null;
  const parentType = parent ? channelType(parent) : null;
  const lastOrder = lastSiblingId(ts.channels.values(), parentId);

  /** The kinds this dialog can pick from, per the permissions and the parent. */
  const typeChoices = computed<ChannelType[]>(() => {
    const allowed = channel.value ? cp.editTypes(channelType(channel.value)) : cp.createTypes();
    return allowed.filter((ty) => !parentType || RANK[ty] <= RANK[parentType]);
  });

  const startType =
    TYPE_PREFERENCE.find((ty) => typeChoices.value.includes(ty)) ?? parentType ?? "temporary";
  const descLoaded = ref(!cid || ts.descriptions.has(cid));
  /** What the server has now; the edit sends the difference to this. */
  const baseline = shallowRef<ChannelFormValues>(
    channel.value
      ? formFromChannel(channel.value, (cid && ts.descriptions.get(cid)) ?? "")
      : newChannelForm(startType, lastOrder),
  );

  const form = useForm<ChannelFormValues>({
    initial: () => ({ ...baseline.value }),
    rules: channelFormRules(
      {
        parentType,
        editing,
        hadPassword: baseline.value.hasPassword,
        maxDeleteDelay: cp.maxDeleteDelay(),
      },
      (key) => t(key),
    ),
    onSubmit: submitValues,
  });

  if (cid && !descLoaded.value) {
    ts.requestDescription(cid);
    const stop = watch(
      () => ts.descriptions.get(cid),
      (text) => {
        if (text === undefined) return;
        descLoaded.value = true;
        if (form.values.description === baseline.value.description) form.values.description = text;
        baseline.value = { ...baseline.value, description: text };
        stop();
      },
    );
  }

  // The channel went away under the dialog (deleted by someone): nothing left to edit.
  if (editing) watch(channel, (ch) => ch === null && onDone());

  const tab = ref<ChannelTab>("basics");
  const tabHasError = (id: ChannelTab) =>
    (Object.keys(form.errors) as (keyof ChannelFormValues)[]).some((k) => TAB_OF[k] === id);

  const orders = computed(() => orderChoices(ts.channels.values(), parentId, cid));

  async function applyIcon(before: number, after: number, target: string | undefined) {
    const change = iconChange(before, after);
    if (!change || !target) return;
    try {
      await setChannelIcon(target, change);
    } catch (err) {
      ts.pushEvent(t("chm.iconFailed", { msg: messageOf(err) }), "error");
    }
  }

  async function submitValues(v: ChannelFormValues) {
    try {
      if (cid) {
        const args = editArgs(cid, baseline.value, v);
        if (args) await editChannel(args);
        await applyIcon(baseline.value.iconId, v.iconId, cid);
      } else {
        const before = new Set(ts.channels.keys());
        await createChannel(createArgs(v, parentId, lastOrder));
        const created = createdChannel(ts.channels.values(), parentId, v.name, before);
        await applyIcon(0, v.iconId, created?.id);
      }
    } catch (err) {
      const field = fieldOfError(err);
      return field ? { fields: { [field]: messageOf(err) } } : messageOf(err);
    }
  }

  async function submit(): Promise<void> {
    const ok = await form.submit();
    if (ok) {
      onDone();
      return;
    }
    const bad = CHANNEL_TABS.find((x) => tabHasError(x.id));
    if (bad && !tabHasError(tab.value)) tab.value = bad.id;
  }

  return {
    form,
    tab,
    tabHasError,
    editing,
    channel,
    parent,
    descLoaded,
    typeChoices,
    orders,
    perms: cp,
    wasDefault: baseline.value.isDefault,
    hadPassword: baseline.value.hasPassword,
    submit,
  };
}

export type ChannelFormState = ReturnType<typeof useChannelForm>;

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
