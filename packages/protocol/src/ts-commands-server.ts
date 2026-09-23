/**
 * Argument schemas for the M4 server administration commands: privilege keys,
 * server and channel groups, the virtual server's own settings, its log and
 * its connection statistics. They join the allow list in ts-commands.ts; the
 * hub's builders are at the end of apps/hub/src/gateway/commands.ts.
 *
 * Limits are what a live TS3 3.13 server accepted (it answers 1541 "invalid
 * parameter size" past them): group names 30 characters, the server name 64,
 * the host message 200 characters (255 ASCII failed, 200 CJK passed), the
 * welcome message 1024 *bytes* (1024 ASCII passed, 400 CJK did not), and a
 * needed security level of 128 (130 failed).
 *
 * `serveredit` is deliberately narrow: the fields a server admin changes day
 * to day. Passwords, ports, anti-flood and quotas are left to the native
 * client, and any key outside the list is refused rather than passed through.
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";
import { utf8Length } from "./ts-commands-admin.js";

const dbIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");
const noArgs = z.object({}).strict();

/** Privilege keys are 40 base64 characters on TS3; a little room for other servers. */
export const PRIVILEGE_KEY_MAX = 100;
export const PRIVILEGE_KEY_DESC_MAX = 255;
export const GROUP_NAME_MAX = 30;
export const SERVER_NAME_MAX = 64;
export const WELCOME_MESSAGE_MAX_BYTES = 1024;
export const HOST_MESSAGE_MAX = 200;
export const SERVER_URL_MAX = 255;
export const SECURITY_LEVEL_MAX = 128;
/** Rows per `logview` page; the server itself answers at most 100. */
export const LOG_LINES_MAX = 100;

const UINT16_MAX = 65_535;
const INT32_MAX = 2_147_483_647;

const tokenSchema = z
  .string()
  .min(1)
  .max(PRIVILEGE_KEY_MAX)
  .regex(/^[A-Za-z0-9+/=]+$/, "must be a privilege key");

export const PrivilegeKeyUseArgs = z.object({ token: tokenSchema }).strict();
export const PrivilegeKeyDeleteArgs = z.object({ token: tokenSchema }).strict();

/** Token types: 0 a server group, 1 a channel group in one channel (`tokenid2`). */
export const TOKEN_SERVER_GROUP = 0;
export const TOKEN_CHANNEL_GROUP = 1;

export const PrivilegeKeyAddArgs = z
  .object({
    tokentype: z.union([z.literal(TOKEN_SERVER_GROUP), z.literal(TOKEN_CHANNEL_GROUP)]),
    tokenid1: dbIdSchema,
    tokenid2: dbIdSchema.optional(),
    tokendescription: z.string().max(PRIVILEGE_KEY_DESC_MAX),
  })
  .strict()
  .refine(
    (a) => (a.tokentype === TOKEN_CHANNEL_GROUP) === (a.tokenid2 !== undefined),
    "a channel group key names its channel, a server group key none",
  );

const groupName = z.string().trim().min(1).max(GROUP_NAME_MAX);

/**
 * Only regular groups: template and query groups belong to the instance's
 * administrator, and the hub always sends `type=1`.
 */
export const ServerGroupAddArgs = z.object({ name: groupName }).strict();
export const ServerGroupRenameArgs = z.object({ sgid: dbIdSchema, name: groupName }).strict();
/** Copies into a new group (`tsgid=0`); overwriting an existing one is not offered. */
export const ServerGroupCopyArgs = z.object({ ssgid: dbIdSchema, name: groupName }).strict();
/** `force` deletes a group that still has members; the caller always says which. */
export const ServerGroupDelArgs = z.object({ sgid: dbIdSchema, force: z.boolean() }).strict();

export const ChannelGroupAddArgs = z.object({ name: groupName }).strict();
export const ChannelGroupRenameArgs = z.object({ cgid: dbIdSchema, name: groupName }).strict();
export const ChannelGroupCopyArgs = z.object({ scgid: dbIdSchema, name: groupName }).strict();
export const ChannelGroupDelArgs = z.object({ cgid: dbIdSchema, force: z.boolean() }).strict();

/** An http(s) address, or "" to clear the field. */
const serverUrl = z
  .string()
  .trim()
  .max(SERVER_URL_MAX)
  .refine((u) => u === "" || /^https?:\/\/\S+$/i.test(u), "must be an http(s) address");

const count = (max: number) => z.number().int().min(0).max(max);

const SERVER_EDIT_SHAPE = {
  virtualserver_name: z.string().trim().min(1).max(SERVER_NAME_MAX),
  virtualserver_welcomemessage: z
    .string()
    .refine((m) => utf8Length(m) <= WELCOME_MESSAGE_MAX_BYTES, "welcome message too long"),
  virtualserver_hostmessage: z.string().max(HOST_MESSAGE_MAX),
  /** 0 none, 1 in the log, 2 a modal, 3 a modal and then disconnect. */
  virtualserver_hostmessage_mode: z.number().int().min(0).max(3),
  virtualserver_hostbanner_url: serverUrl,
  virtualserver_hostbanner_gfx_url: serverUrl,
  virtualserver_hostbutton_url: serverUrl,
  virtualserver_hostbutton_gfx_url: serverUrl,
  virtualserver_maxclients: z.number().int().min(1).max(UINT16_MAX),
  virtualserver_reserved_slots: count(UINT16_MAX),
  virtualserver_default_server_group: dbIdSchema,
  virtualserver_default_channel_group: dbIdSchema,
  virtualserver_needed_identity_security_level: count(SECURITY_LEVEL_MAX),
  virtualserver_min_clients_in_channel_before_forced_silence: count(INT32_MAX),
} as const;

export type ServerEditField = keyof typeof SERVER_EDIT_SHAPE;

/** Every field `serveredit` may change, in the order the edit dialog shows them. */
export const SERVER_EDIT_FIELDS = Object.keys(SERVER_EDIT_SHAPE) as readonly ServerEditField[];

export const ServerEditArgs = z
  .object(SERVER_EDIT_SHAPE)
  .partial()
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "nothing to edit");

export const LogViewArgs = z
  .object({
    lines: z.number().int().min(1).max(LOG_LINES_MAX),
    /** Newest first; paging then walks backwards from `begin_pos`. */
    reverse: z.boolean(),
    /** Byte offset in the log file to read from, as the last page's `last_pos` gave it. */
    begin_pos: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

export const PrivilegeKeyListArgs = noArgs;
export const ServerConnectionInfoArgs = noArgs;
export const ServerGetVariablesArgs = noArgs;
