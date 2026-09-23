/**
 * The TeamSpeak commands a browser may ask the hub to run (`ts.cmd`).
 *
 * This is an allow list, not a passthrough: every command has its own strict
 * argument schema, and the hub builds the TeamSpeak command text itself from
 * the validated fields. Letting a page send raw command text would turn the
 * hub into a remote control for anything the TS identity may do, with none of
 * our limits in front of it.
 *
 * Adding a command means adding a member here (the arguments) and a builder in
 * apps/hub/src/gateway/commands.ts (the wire form). Field names follow the
 * TeamSpeak parameter names where there is one, so the mapping stays obvious;
 * flags are booleans on our side and "1"/"0" on the wire.
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";
import {
  ChannelAddPermArgs,
  ChannelCreateArgs,
  ChannelDeleteArgs,
  ChannelDelPermArgs,
  ChannelEditArgs,
  ChannelMoveArgs,
} from "./ts-channel-commands.js";
import {
  ClientDbEditArgs,
  ClientDbFindArgs,
  ClientDbIdArgs,
  ClientDbInfoArgs,
  ClientDbListArgs,
  ComplainAddArgs,
  ComplainDelAllArgs,
  ComplainDelArgs,
  ComplainListArgs,
  MessageAddArgs,
  MessageFlagArgs,
  MessageIdArgs,
  NameFromUidArgs,
  TempPasswordAddArgs,
  TempPasswordDelArgs,
} from "./ts-commands-admin.js";
import {
  FtCreateDirArgs,
  FtDeleteFileArgs,
  FtGetFileInfoArgs,
  FtGetFileListArgs,
  FtRenameFileArgs,
} from "./ts-file-commands.js";
import {
  ChannelGroupAddPermArgs,
  ChannelGroupDelPermArgs,
  ClientAddPermArgs,
  ClientDelPermArgs,
  FtDeleteAvatarArgs,
  FtDeleteIconArgs,
  ServerGroupAddPermArgs,
  ServerGroupDelPermArgs,
} from "./ts-icon-commands.js";
import { AVATAR_MD5 } from "./ts-internal-files.js";
import {
  ChannelGroupAddArgs,
  ChannelGroupCopyArgs,
  ChannelGroupDelArgs,
  ChannelGroupRenameArgs,
  LogViewArgs,
  PrivilegeKeyAddArgs,
  PrivilegeKeyDeleteArgs,
  PrivilegeKeyListArgs,
  PrivilegeKeyUseArgs,
  ServerConnectionInfoArgs,
  ServerEditArgs,
  ServerGetVariablesArgs,
  ServerGroupAddArgs,
  ServerGroupCopyArgs,
  ServerGroupDelArgs,
  ServerGroupRenameArgs,
} from "./ts-commands-server.js";

/** TeamSpeak uint64 ids travel as decimal strings (see types.ts). */
const dbIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");
const channelIdSchema = dbIdSchema;
const clientIdSchema = z.number().int().min(1).max(65535);
const permIdSchema = z.number().int().min(0).max(65535);

/** Commands that take no arguments still get an object, so `args` is always there. */
const noArgs = z.object({}).strict();

/** Rejects `{}`: an update that changes nothing is a bug on the calling side. */
const atLeastOne = <T extends Record<string, unknown>>(v: T) =>
  Object.values(v).some((x) => x !== undefined);

const ClientUpdateArgs = z
  .object({
    client_nickname: z.string().trim().min(3).max(30).optional(),
    client_away: z.boolean().optional(),
    /** TeamSpeak caps away messages at 80 characters. */
    client_away_message: z.string().max(80).optional(),
    client_talk_request: z.boolean().optional(),
    client_talk_request_msg: z.string().max(50).optional(),
    client_is_channel_commander: z.boolean().optional(),
    /** MD5 of the uploaded avatar file (lowercase hex), "" for none (see ts-internal-files.ts). */
    client_flag_avatar: z.string().regex(AVATAR_MD5).optional(),
  })
  .strict()
  .refine(atLeastOne, "nothing to update");

const ClientEditArgs = z
  .object({
    clid: clientIdSchema,
    /** TeamSpeak caps descriptions at 200 characters. */
    client_description: z.string().max(200).optional(),
    client_is_talker: z.boolean().optional(),
  })
  .strict()
  .refine(({ clid: _clid, ...rest }) => atLeastOne(rest), "nothing to edit");

/** A channel list goes out as one row per channel (`cid=1|cid=2`). */
const ChannelListArgs = z.object({ cids: z.array(channelIdSchema).min(1).max(100) }).strict();

const PermOverviewArgs = z
  .object({
    cid: channelIdSchema,
    cldbid: dbIdSchema,
    /** Permission ids to explain; omitted or empty asks for all of them. */
    permids: z.array(permIdSchema).max(100).optional(),
  })
  .strict();

const ClientPermListArgs = z.object({ cldbid: dbIdSchema }).strict();

/** `cpw` is the plain password; the hub hashes it the way the client protocol wants. */
const ClientMoveArgs = z
  .object({ clid: clientIdSchema, cid: channelIdSchema, cpw: z.string().max(128).optional() })
  .strict();

/** Kick reasons: 4 = from the channel (to the default one), 5 = from the server. */
export const KICK_FROM_CHANNEL = 4;
export const KICK_FROM_SERVER = 5;
/** TeamSpeak caps kick (and ban) reasons at 80 characters. */
export const KICK_REASON_MAX = 80;

const ClientKickArgs = z
  .object({
    clid: clientIdSchema,
    reasonid: z.union([z.literal(KICK_FROM_CHANNEL), z.literal(KICK_FROM_SERVER)]),
    reasonmsg: z.string().max(KICK_REASON_MAX).optional(),
  })
  .strict();

const ServerGroupMemberArgs = z.object({ sgid: dbIdSchema, cldbid: dbIdSchema }).strict();

const SetClientChannelGroupArgs = z
  .object({ cgid: dbIdSchema, cid: channelIdSchema, cldbid: dbIdSchema })
  .strict();
/** Ban length in seconds; 0 is permanent. TeamSpeak keeps it as a uint32. */
const banTimeSchema = z.number().int().min(0).max(4_294_967_295);
/** A live TS3 server cuts ban reasons at 80 characters; better refused than cut. */
const banReasonSchema = z.string().max(80);

/** Bans a connected client: TeamSpeak adds one ban on its UID and one on its IP. */
const BanClientArgs = z
  .object({ clid: clientIdSchema, time: banTimeSchema, banreason: banReasonSchema })
  .strict();

/** A ban rule; `name` is a regular expression on nicknames. At least one of the three. */
const banRuleField = (max: number) => z.string().trim().min(1).max(max).optional();
const BanAddArgs = z
  .object({
    ip: banRuleField(64),
    name: banRuleField(100),
    uid: banRuleField(64),
    time: banTimeSchema,
    banreason: banReasonSchema,
  })
  .strict()
  .refine((a) => !!(a.ip || a.name || a.uid), "ban needs an ip, name or uid");

const BanDelArgs = z.object({ banid: dbIdSchema }).strict();

/** Short, opaque correlation id chosen by the browser; echoed in `ts.cmdResult`. */
export const TsCmdIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[\w-]+$/);

/**
 * `ts.cmd` as it arrives from the browser: one member per allowed command,
 * discriminated on `cmd` so each gets its own argument schema.
 */
const member = <C extends string, A extends z.ZodType>(cmd: C, args: A) =>
  z.object({ type: z.literal("ts.cmd"), id: TsCmdIdSchema, cmd: z.literal(cmd), args });

export const TsCmdRequestSchema = z.discriminatedUnion("cmd", [
  member("clientupdate", ClientUpdateArgs),
  member("clientedit", ClientEditArgs),
  member("channelsubscribe", ChannelListArgs),
  member("channelunsubscribe", ChannelListArgs),
  member("channelsubscribeall", noArgs),
  member("channelunsubscribeall", noArgs),
  member("permissionlist", noArgs),
  member("servergrouplist", noArgs),
  member("channelgrouplist", noArgs),
  member("permoverview", PermOverviewArgs),
  member("clientpermlist", ClientPermListArgs),
  // M2 channels
  member("channelcreate", ChannelCreateArgs),
  member("channeledit", ChannelEditArgs),
  member("channeldelete", ChannelDeleteArgs),
  member("channelmove", ChannelMoveArgs),
  member("channeladdperm", ChannelAddPermArgs),
  member("channeldelperm", ChannelDelPermArgs),
  // M2 moderation
  member("clientmove", ClientMoveArgs),
  member("clientkick", ClientKickArgs),
  member("servergroupaddclient", ServerGroupMemberArgs),
  member("servergroupdelclient", ServerGroupMemberArgs),
  member("setclientchannelgroup", SetClientChannelGroupArgs),
  member("banclient", BanClientArgs),
  member("banadd", BanAddArgs),
  member("banlist", noArgs),
  member("bandel", BanDelArgs),
  member("bandelall", noArgs),
  // M2 admin tools (schemas in ts-commands-admin.ts)
  member("complainadd", ComplainAddArgs),
  member("complainlist", ComplainListArgs),
  member("complaindel", ComplainDelArgs),
  member("complaindelall", ComplainDelAllArgs),
  member("messagelist", noArgs),
  member("messageget", MessageIdArgs),
  member("messageupdateflag", MessageFlagArgs),
  member("messagedel", MessageIdArgs),
  member("messageadd", MessageAddArgs),
  member("clientgetnamefromuid", NameFromUidArgs),
  member("clientdblist", ClientDbListArgs),
  member("clientdbfind", ClientDbFindArgs),
  member("clientdbinfo", ClientDbInfoArgs),
  member("clientdbedit", ClientDbEditArgs),
  member("clientdbdelete", ClientDbIdArgs),
  member("servertemppasswordlist", noArgs),
  member("servertemppasswordadd", TempPasswordAddArgs),
  member("servertemppassworddel", TempPasswordDelArgs),
  // M3 files (read-only; transfers are HTTP streams, see files.ts)
  member("ftgetfilelist", FtGetFileListArgs),
  member("ftgetfileinfo", FtGetFileInfoArgs),
  // M3 file browser
  member("ftcreatedir", FtCreateDirArgs),
  member("ftrenamefile", FtRenameFileArgs),
  member("ftdeletefile", FtDeleteFileArgs),
  // M3 avatars and icons (schemas in ts-icon-commands.ts)
  member("servergroupaddperm", ServerGroupAddPermArgs),
  member("servergroupdelperm", ServerGroupDelPermArgs),
  member("channelgroupaddperm", ChannelGroupAddPermArgs),
  member("channelgroupdelperm", ChannelGroupDelPermArgs),
  member("clientaddperm", ClientAddPermArgs),
  member("clientdelperm", ClientDelPermArgs),
  member("ftdeleteicon", FtDeleteIconArgs),
  member("ftdeleteavatar", FtDeleteAvatarArgs),
  // M4 server administration (schemas in ts-commands-server.ts)
  member("privilegekeyuse", PrivilegeKeyUseArgs),
  member("privilegekeylist", PrivilegeKeyListArgs),
  member("privilegekeyadd", PrivilegeKeyAddArgs),
  member("privilegekeydelete", PrivilegeKeyDeleteArgs),
  member("servergroupadd", ServerGroupAddArgs),
  member("servergroupdel", ServerGroupDelArgs),
  member("servergrouprename", ServerGroupRenameArgs),
  member("servergroupcopy", ServerGroupCopyArgs),
  member("channelgroupadd", ChannelGroupAddArgs),
  member("channelgroupdel", ChannelGroupDelArgs),
  member("channelgrouprename", ChannelGroupRenameArgs),
  member("channelgroupcopy", ChannelGroupCopyArgs),
  member("serveredit", ServerEditArgs),
  member("servergetvariables", ServerGetVariablesArgs),
  member("logview", LogViewArgs),
  member("serverrequestconnectioninfo", ServerConnectionInfoArgs),
]);

export type TsCmdRequest = z.infer<typeof TsCmdRequestSchema>;
export type TsCmdName = TsCmdRequest["cmd"];
/** The arguments of one command, e.g. `TsCmdArgs<"clientedit">`. */
export type TsCmdArgs<C extends TsCmdName> = Extract<TsCmdRequest, { cmd: C }>["args"];

/** Every command name the hub accepts. */
export const TS_CMD_NAMES: readonly TsCmdName[] = TsCmdRequestSchema.options.map(
  (o) => o.shape.cmd.value,
);

/** One result row: TeamSpeak's key=value pairs, unescaped. */
export type TsCmdRow = Record<string, string>;

/**
 * The hub's answer to a `ts.cmd`, matched by `id`.
 *
 * On failure `code` is the TeamSpeak error id ("2568") or one of the hub's own
 * codes (TS_CMD_HUB_CODES); `message` is a text code (see text-code.ts) the
 * web client translates, or raw server text when there is no key for it.
 */
export type TsCmdResult =
  | { type: "ts.cmdResult"; id: string; ok: true; rows: TsCmdRow[] }
  | {
      type: "ts.cmdResult";
      id: string;
      ok: false;
      code: string;
      message: string;
      /** For "insufficient permissions": the permission the server checked, by name. */
      failedPermission?: string;
    };

/** Failure codes that come from the hub rather than from the TeamSpeak server. */
export const TS_CMD_HUB_CODES = {
  notConnected: "not_connected",
  rateLimited: "rate_limited",
  badArgs: "bad_args",
  timeout: "timeout",
  failed: "failed",
  /** Would ban the hub's own address, which every web user shares (see ban-rules.ts). */
  sharedAddress: "shared_address",
  /** A ban rule the hub will not send: not a literal IP, or a nickname pattern too broad or too costly. */
  badBanRule: "bad_ban_rule",
} as const;

/**
 * The permissions a TeamSpeak server says this client has
 * (`notifyclientneededpermissions`), keyed by permission name. The first
 * message after a connect is complete (`full`); later ones only carry what
 * changed and are merged over it.
 */
export interface PermsMessage {
  type: "perms";
  full: boolean;
  values: Record<string, number>;
}
