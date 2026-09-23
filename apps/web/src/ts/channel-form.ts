/**
 * The create / edit channel dialog's data, free of Vue and i18n so it is
 * tested on plain node: form values from a channel, the `channelcreate`
 * arguments for a new one, only the changed fields for `channeledit`, and the
 * TeamSpeak rules the server would otherwise answer with an error:
 *
 *  - the default channel must be permanent (774) and cannot have a password;
 *  - a subchannel cannot be "more permanent" than its parent (776);
 *  - `channel_delete_delay` only exists for temporary channels (1538 else);
 *  - the legacy codecs cannot be set any more (1538), so they are read-only.
 *
 * The password is write-only: the server never tells anyone what it is, so
 * a blank field on a protected channel keeps the old one.
 */
import {
  CHANNEL_NAME_MAX,
  CHANNEL_PASSWORD_MAX,
  CHANNEL_TOPIC_MAX,
  CHANNEL_DESCRIPTION_MAX,
  channelDescriptionFits,
  Codec,
  type TsChannel,
  type TsCmdArgs,
} from "@jinz/protocol";
import type { Rules } from "../composables/form-core";
import { sortSiblings } from "./tree";

export { CHANNEL_NAME_MAX, CHANNEL_PASSWORD_MAX, CHANNEL_TOPIC_MAX, CHANNEL_DESCRIPTION_MAX };

export type ChannelType = "permanent" | "semi" | "temporary";
export type FamilyMode = "inherit" | "unlimited" | "limited";

export interface ChannelFormValues {
  name: string;
  namePhonetic: string;
  topic: string;
  /** Password protection on; `password` blank on an edit keeps the old one. */
  hasPassword: boolean;
  password: string;
  description: string;
  codec: number;
  quality: number;
  maxClientsLimited: boolean;
  maxClients: number;
  familyMode: FamilyMode;
  maxFamilyClients: number;
  type: ChannelType;
  isDefault: boolean;
  neededTalkPower: number;
  /** The sibling this channel follows ("0" = first). */
  order: string;
  iconId: number;
  /** Seconds; temporary channels only. */
  deleteDelay: number;
}

/** What a live TS3 server assumes for fields `channelcreate` leaves out. */
const SERVER_DEFAULT_CODEC = Codec.OpusVoice;
const SERVER_DEFAULT_QUALITY = 5;
/** The native client's starting quality for a new channel. */
const NEW_CHANNEL_QUALITY = 6;
/** A starting number for when a limit is switched on. */
const DEFAULT_LIMIT = 10;
export const QUALITY_MAX = 10;

export const OPUS_CODECS: readonly number[] = [Codec.OpusVoice, Codec.OpusMusic];
export const isSendableCodec = (codec: number): codec is 4 | 5 => OPUS_CODECS.includes(codec);

export function channelType(ch: TsChannel): ChannelType {
  if (ch.flags.permanent) return "permanent";
  if (ch.flags.semiPermanent) return "semi";
  return "temporary";
}

const TYPE_RANK: Record<ChannelType, number> = { temporary: 0, semi: 1, permanent: 2 };

export function formFromChannel(ch: TsChannel, description: string): ChannelFormValues {
  const f = ch.flags;
  return {
    name: ch.name,
    namePhonetic: ch.namePhonetic,
    topic: ch.topic,
    hasPassword: f.password,
    password: "",
    description,
    codec: ch.codec,
    quality: ch.codecQuality,
    maxClientsLimited: !f.maxClientsUnlimited,
    maxClients: f.maxClientsUnlimited ? DEFAULT_LIMIT : ch.maxClients,
    familyMode: f.maxFamilyClientsInherited
      ? "inherit"
      : f.maxFamilyClientsUnlimited
        ? "unlimited"
        : "limited",
    maxFamilyClients:
      f.maxFamilyClientsInherited || f.maxFamilyClientsUnlimited
        ? DEFAULT_LIMIT
        : ch.maxFamilyClients,
    type: channelType(ch),
    isDefault: f.default,
    neededTalkPower: ch.neededTalkPower,
    order: ch.order,
    iconId: ch.iconId,
    deleteDelay: ch.deleteDelay,
  };
}

/** A blank form for a new channel of `type`, placed after `order`. */
export function newChannelForm(type: ChannelType, order: string): ChannelFormValues {
  return {
    name: "",
    namePhonetic: "",
    topic: "",
    hasPassword: false,
    password: "",
    description: "",
    codec: Codec.OpusVoice,
    quality: NEW_CHANNEL_QUALITY,
    maxClientsLimited: false,
    maxClients: DEFAULT_LIMIT,
    familyMode: "unlimited",
    maxFamilyClients: DEFAULT_LIMIT,
    type,
    isDefault: false,
    neededTalkPower: 0,
    order,
    iconId: 0,
    deleteDelay: 0,
  };
}

type Props = Omit<TsCmdArgs<"channeledit">, "cid">;

const typeFlags = (type: ChannelType): Props => ({
  channel_flag_permanent: type === "permanent",
  channel_flag_semi_permanent: type === "semi",
});

const maxClientsProps = (v: ChannelFormValues): Props =>
  v.maxClientsLimited
    ? { channel_maxclients: v.maxClients, channel_flag_maxclients_unlimited: false }
    : { channel_maxclients: -1, channel_flag_maxclients_unlimited: true };

const familyProps = (v: ChannelFormValues): Props => {
  switch (v.familyMode) {
    case "inherit":
      return { channel_flag_maxfamilyclients_inherited: true };
    case "unlimited":
      return {
        channel_flag_maxfamilyclients_unlimited: true,
        channel_flag_maxfamilyclients_inherited: false,
      };
    case "limited":
      return {
        channel_maxfamilyclients: v.maxFamilyClients,
        channel_flag_maxfamilyclients_unlimited: false,
        channel_flag_maxfamilyclients_inherited: false,
      };
  }
};

/** Drops undefined entries so the result compares cleanly and validates strictly. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * `channelcreate` arguments. Only what differs from the server's defaults
 * goes out: each field needs its own b_channel_create_with_* permission, so
 * sending a default value could fail for nothing. `lastOrder` is where the
 * server puts a channel without `channel_order` (after the last sibling).
 */
export function createArgs(
  v: ChannelFormValues,
  parentId: string,
  lastOrder: string,
): TsCmdArgs<"channelcreate"> {
  const type = v.isDefault ? "permanent" : v.type;
  return compact({
    cpid: parentId !== "0" ? parentId : undefined,
    channel_name: v.name.trim(),
    channel_name_phonetic: v.namePhonetic.trim() || undefined,
    channel_topic: v.topic || undefined,
    channel_description: v.description || undefined,
    channel_password: v.hasPassword && v.password ? v.password : undefined,
    channel_codec:
      v.codec !== SERVER_DEFAULT_CODEC && isSendableCodec(v.codec) ? v.codec : undefined,
    channel_codec_quality: v.quality !== SERVER_DEFAULT_QUALITY ? v.quality : undefined,
    ...(v.maxClientsLimited ? maxClientsProps(v) : {}),
    ...(v.familyMode !== "unlimited" ? familyProps(v) : {}),
    channel_flag_permanent: type === "permanent" || undefined,
    channel_flag_semi_permanent: type === "semi" || undefined,
    channel_flag_default: v.isDefault || undefined,
    channel_needed_talk_power: v.neededTalkPower !== 0 ? v.neededTalkPower : undefined,
    channel_order: v.order !== lastOrder ? v.order : undefined,
    channel_delete_delay: type === "temporary" && v.deleteDelay > 0 ? v.deleteDelay : undefined,
  });
}

/** `channeledit` arguments with only the fields that changed, or null when nothing did. */
export function editArgs(
  cid: string,
  initial: ChannelFormValues,
  v: ChannelFormValues,
): TsCmdArgs<"channeledit"> | null {
  const changed = <K extends keyof ChannelFormValues>(k: K) => initial[k] !== v[k];
  const limitChanged =
    changed("maxClientsLimited") || (v.maxClientsLimited && changed("maxClients"));
  const familyChanged =
    changed("familyMode") || (v.familyMode === "limited" && changed("maxFamilyClients"));
  const passwordRemoved = initial.hasPassword && !v.hasPassword;
  const passwordSet = v.hasPassword && v.password !== "";
  const props: Props = compact({
    channel_name: v.name.trim() !== initial.name ? v.name.trim() : undefined,
    channel_name_phonetic: changed("namePhonetic") ? v.namePhonetic.trim() : undefined,
    channel_topic: changed("topic") ? v.topic : undefined,
    channel_description: changed("description") ? v.description : undefined,
    channel_password: passwordRemoved ? "" : passwordSet ? v.password : undefined,
    channel_codec: changed("codec") && isSendableCodec(v.codec) ? v.codec : undefined,
    channel_codec_quality: changed("quality") ? v.quality : undefined,
    ...(limitChanged ? maxClientsProps(v) : {}),
    ...(familyChanged ? familyProps(v) : {}),
    ...(changed("type") ? typeFlags(v.type) : {}),
    channel_flag_default: changed("isDefault") ? v.isDefault : undefined,
    channel_needed_talk_power: changed("neededTalkPower") ? v.neededTalkPower : undefined,
    channel_order: changed("order") ? v.order : undefined,
    channel_delete_delay:
      v.type === "temporary" && (changed("deleteDelay") || changed("type")) && v.deleteDelay > 0
        ? v.deleteDelay
        : undefined,
  });
  return Object.keys(props).length > 0 ? { cid, ...props } : null;
}

/** The icon is a channel permission (`i_icon_id`), set apart from the other fields. */
export type IconChange = { kind: "set"; iconId: number } | { kind: "clear" };

export function iconChange(before: number, after: number): IconChange | null {
  if (before === after) return null;
  return after === 0 ? { kind: "clear" } : { kind: "set", iconId: after };
}

export interface ChannelRuleContext {
  /** Type of the parent channel; null for a top-level channel. */
  readonly parentType: ChannelType | null;
  readonly editing: boolean;
  /** Editing a channel that already has a password (a blank field keeps it). */
  readonly hadPassword: boolean;
  /** i_channel_create_modify_with_temp_delete_delay; -1 when unknown or unlimited. */
  readonly maxDeleteDelay: number;
}

/** Message keys the rules use; the caller translates them (see i18n "chm."). */
export type ChannelRuleMessage =
  | "chm.errName"
  | "chm.errPasswordRequired"
  | "chm.errDefaultPermanent"
  | "chm.errDefaultPassword"
  | "chm.errParentType"
  | "chm.errLimit"
  | "chm.errQuality"
  | "chm.errDeleteDelay"
  | "chm.errDescriptionSize";

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

export function channelFormRules(
  ctx: ChannelRuleContext,
  msg: (key: ChannelRuleMessage) => string,
): Rules<ChannelFormValues> {
  return {
    name: (name) => {
      const n = [...name.trim()].length;
      return n === 0 || n > CHANNEL_NAME_MAX ? msg("chm.errName") : null;
    },
    password: (password, v) =>
      v.hasPassword && password === "" && !(ctx.editing && ctx.hadPassword)
        ? msg("chm.errPasswordRequired")
        : null,
    hasPassword: (on, v) => (on && v.isDefault ? msg("chm.errDefaultPassword") : null),
    type: (type, v) => {
      if (v.isDefault && type !== "permanent") return msg("chm.errDefaultPermanent");
      if (ctx.parentType && TYPE_RANK[type] > TYPE_RANK[ctx.parentType]) {
        return msg("chm.errParentType");
      }
      return null;
    },
    maxClients: (n, v) => (v.maxClientsLimited && !isCount(n) ? msg("chm.errLimit") : null),
    maxFamilyClients: (n, v) =>
      v.familyMode === "limited" && !isCount(n) ? msg("chm.errLimit") : null,
    quality: (q) =>
      Number.isInteger(q) && q >= 0 && q <= QUALITY_MAX ? null : msg("chm.errQuality"),
    deleteDelay: (d, v) => {
      if (v.type !== "temporary") return null;
      if (!isCount(d)) return msg("chm.errDeleteDelay");
      return ctx.maxDeleteDelay >= 0 && d > ctx.maxDeleteDelay ? msg("chm.errDeleteDelay") : null;
    },
    neededTalkPower: (n) => (Number.isInteger(n) && n >= -1 ? null : msg("chm.errLimit")),
    // The server counts bytes (and times out past ~9 KB escaped), see ts-channel-commands.ts.
    description: (d) => (channelDescriptionFits(d) ? null : msg("chm.errDescriptionSize")),
  };
}

export interface OrderChoice {
  /** The channel to follow; "0" = first. */
  readonly value: string;
  /** That channel's name; null for "first". */
  readonly name: string | null;
}

/** Where a channel can sit among the children of `parentId` (itself left out). */
export function orderChoices(
  channels: Iterable<TsChannel>,
  parentId: string,
  selfId: string | null,
): OrderChoice[] {
  const siblings = sortSiblings(
    [...channels].filter((c) => c.parentId === parentId && c.id !== selfId),
  );
  return [{ value: "0", name: null }, ...siblings.map((c) => ({ value: c.id, name: c.name }))];
}

/** The last sibling under `parentId` ("0" when none): where a new channel lands by default. */
export function lastSiblingId(channels: Iterable<TsChannel>, parentId: string): string {
  const choices = orderChoices(channels, parentId, null);
  return choices[choices.length - 1]!.value;
}
