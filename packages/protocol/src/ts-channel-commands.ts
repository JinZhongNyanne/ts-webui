/**
 * Arguments of the M2 channel commands (create, edit, delete, move, icon),
 * members of the `ts.cmd` allow list in ts-commands.ts. Field names are the
 * TeamSpeak parameter names; the hub builds the wire text (see
 * apps/hub/src/gateway/channel-commands.ts).
 *
 * Checked against a live TS3 3.13 server from a client connection:
 *  - `channel_icon_id` is not a channel property there (1538 invalid
 *    parameter); the icon is the channel permission `i_icon_id`, set with
 *    `channeladdperm` and removed with `channeldelperm`.
 *  - The legacy codecs (Speex, CELT) are refused (1538), so only Opus goes out.
 *  - `channel_delete_delay` is only accepted for temporary channels.
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";
import { tsWireLength, utf8Length } from "./ts-commands-admin.js";

/** TeamSpeak uint64 ids travel as decimal strings (see types.ts). */
const channelIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");

/** TeamSpeak's limits on channel texts. */
export const CHANNEL_NAME_MAX = 40;
export const CHANNEL_TOPIC_MAX = 255;
export const CHANNEL_DESCRIPTION_MAX = 8192;
/**
 * A live TS3 3.13 server takes 8192 bytes of description (2730 CJK characters
 * passed, 2731 got 1541) and does not answer at all once the escaped command
 * grows past about 9 KB (9000 escaped bytes passed, 10200 did not), which the
 * client library can only time out on.
 */
export const CHANNEL_DESCRIPTION_MAX_BYTES = 8192;
export const CHANNEL_DESCRIPTION_MAX_WIRE = 9000;

/** Whether a description fits both of the server's limits. */
export const channelDescriptionFits = (d: string) =>
  utf8Length(d) <= CHANNEL_DESCRIPTION_MAX_BYTES && tsWireLength(d) <= CHANNEL_DESCRIPTION_MAX_WIRE;
export const CHANNEL_PASSWORD_MAX = 255;

const INT32_MAX = 2_147_483_647;
const UINT32_MAX = 4_294_967_295;

/** A client count; -1 is TeamSpeak's "unlimited". */
const clientLimit = z.number().int().min(-1).max(INT32_MAX);

/** Everything `channelcreate` and `channeledit` share. */
const channelProps = {
  channel_name: z.string().trim().min(1).max(CHANNEL_NAME_MAX).optional(),
  channel_name_phonetic: z.string().max(CHANNEL_NAME_MAX).optional(),
  channel_topic: z.string().max(CHANNEL_TOPIC_MAX).optional(),
  channel_description: z
    .string()
    .max(CHANNEL_DESCRIPTION_MAX)
    .refine(channelDescriptionFits, "description too long")
    .optional(),
  /** Empty removes the password (edit). */
  channel_password: z.string().max(CHANNEL_PASSWORD_MAX).optional(),
  /** 4 Opus Voice, 5 Opus Music. */
  channel_codec: z.union([z.literal(4), z.literal(5)]).optional(),
  channel_codec_quality: z.number().int().min(0).max(10).optional(),
  channel_maxclients: clientLimit.optional(),
  channel_maxfamilyclients: clientLimit.optional(),
  channel_flag_maxclients_unlimited: z.boolean().optional(),
  channel_flag_maxfamilyclients_unlimited: z.boolean().optional(),
  channel_flag_maxfamilyclients_inherited: z.boolean().optional(),
  channel_flag_permanent: z.boolean().optional(),
  channel_flag_semi_permanent: z.boolean().optional(),
  channel_flag_default: z.boolean().optional(),
  channel_needed_talk_power: z.number().int().min(-1).max(INT32_MAX).optional(),
  /** The channel this one follows among its siblings ("0" = first). */
  channel_order: channelIdSchema.optional(),
  /** Seconds a temporary channel lives on once empty. */
  channel_delete_delay: z.number().int().min(0).max(INT32_MAX).optional(),
};

export const ChannelCreateArgs = z
  .object({
    /** Parent channel; omitted or "0" creates a top-level channel. */
    cpid: channelIdSchema.optional(),
    ...channelProps,
    channel_name: z.string().trim().min(1).max(CHANNEL_NAME_MAX),
  })
  .strict();

export const ChannelEditArgs = z
  .object({ cid: channelIdSchema, ...channelProps })
  .strict()
  .refine(
    ({ cid: _cid, ...rest }) => Object.values(rest).some((v) => v !== undefined),
    "nothing to edit",
  );

export const ChannelDeleteArgs = z
  .object({
    cid: channelIdSchema,
    /** Also delete when clients or subchannels are inside (they are moved out / deleted). */
    force: z.boolean(),
  })
  .strict();

/** A move to another parent; within the same parent use channeledit channel_order (770 otherwise). */
export const ChannelMoveArgs = z
  .object({ cid: channelIdSchema, cpid: channelIdSchema, order: channelIdSchema.optional() })
  .strict();

/** Only the channel icon for now; M4's permission editor widens this. */
const channelPermSid = z.literal("i_icon_id");

export const ChannelAddPermArgs = z
  .object({
    cid: channelIdSchema,
    permsid: channelPermSid,
    /** Icon ids are CRC32s: unsigned on our side, sent as int32 by the hub. */
    permvalue: z
      .number()
      .int()
      .min(-INT32_MAX - 1)
      .max(UINT32_MAX),
  })
  .strict();

export const ChannelDelPermArgs = z
  .object({ cid: channelIdSchema, permsid: channelPermSid })
  .strict();
