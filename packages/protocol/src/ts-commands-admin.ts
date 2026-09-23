/**
 * Argument schemas for the M2 admin tools: complaints, offline messages, the
 * client database and temporary server passwords. They join the allow list in
 * ts-commands.ts; the hub's builders are in apps/hub/src/gateway/commands.ts.
 *
 * Limits are the ones a TeamSpeak 3 server enforced when probed (it answers
 * 1541 "invalid parameter size" past them), counted in characters, not bytes
 * (200 CJK characters passed where 201 did not): complaint 200, offline
 * message subject 200 and body 4096, temporary password around 250 (we keep
 * 128) and its description 255. A body of 4096 CJK characters (12 KB) got an
 * error without our return code, which the client library can only time out
 * on, so bodies are also capped in UTF-8 bytes (8100 went through).
 */
import { z } from "zod";
import { DECIMAL_ID } from "./ids.js";

const dbIdSchema = z.string().regex(DECIMAL_ID, "must be a decimal id");
/** Bytes a text takes as UTF-8, which is what TeamSpeak's size limits count. */
export const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** Characters the command escaping turns into two (`\\s`, `\\p`, `\\/`, …). */
const ESCAPED = /[\\/ |\x07\b\f\n\r\t\v]/g;

/** Bytes a text takes on the wire once escaped: a server that gets too long a command does not answer at all. */
export const tsWireLength = (s: string) => utf8Length(s) + (s.match(ESCAPED)?.length ?? 0);
/** Unique ids are base64 (28 characters for a normal identity). */
const uidSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9+/=]+$/, "must be a unique id");

export const COMPLAINT_MAX = 200;
export const OFFLINE_SUBJECT_MAX = 200;
export const OFFLINE_MESSAGE_MAX = 4096;
export const OFFLINE_MESSAGE_MAX_BYTES = 8000;
export const TEMP_PASSWORD_MAX = 128;
export const TEMP_PASSWORD_DESC_MAX = 255;
/** Rows per `clientdblist` page; the server itself caps a page at 200. */
export const CLIENT_DB_PAGE_MAX = 200;

export const ComplainAddArgs = z
  .object({ tcldbid: dbIdSchema, message: z.string().min(1).max(COMPLAINT_MAX) })
  .strict();
export const ComplainListArgs = z.object({ tcldbid: dbIdSchema.optional() }).strict();
export const ComplainDelArgs = z.object({ tcldbid: dbIdSchema, fcldbid: dbIdSchema }).strict();
export const ComplainDelAllArgs = z.object({ tcldbid: dbIdSchema }).strict();

export const MessageIdArgs = z.object({ msgid: dbIdSchema }).strict();
export const MessageFlagArgs = z.object({ msgid: dbIdSchema, flag: z.boolean() }).strict();
export const MessageAddArgs = z
  .object({
    cluid: uidSchema,
    subject: z.string().min(1).max(OFFLINE_SUBJECT_MAX),
    message: z
      .string()
      .max(OFFLINE_MESSAGE_MAX)
      .refine((m) => utf8Length(m) <= OFFLINE_MESSAGE_MAX_BYTES, "message too long"),
  })
  .strict();
/** UIDs per `clientgetnamefromuid`: one row each, answered one notify each. */
export const NAME_LOOKUP_MAX = 50;
export const NameFromUidArgs = z
  .object({ cluids: z.array(uidSchema).min(1).max(NAME_LOOKUP_MAX) })
  .strict();

export const ClientDbListArgs = z
  .object({
    start: z
      .number()
      .int()
      .min(0)
      .max(2 ** 31 - 1),
    duration: z.number().int().min(1).max(CLIENT_DB_PAGE_MAX),
    /** `-count`: the first row also carries the total. */
    count: z.boolean().optional(),
  })
  .strict();
export const ClientDbFindArgs = z
  .object({
    /** SQL LIKE pattern (`%` wildcards) on nicknames, or an exact UID with `uid`. */
    pattern: z.string().min(1).max(100),
    uid: z.boolean().optional(),
  })
  .strict();
export const ClientDbIdArgs = z.object({ cldbid: dbIdSchema }).strict();
/**
 * Entries per `clientdbinfo`: one row each, answered in one go. A live server
 * fails the whole command (512) when any one of them does not exist.
 */
export const CLIENT_DB_INFO_MAX = 25;
export const ClientDbInfoArgs = z
  .object({ cldbids: z.array(dbIdSchema).min(1).max(CLIENT_DB_INFO_MAX) })
  .strict();
export const ClientDbEditArgs = z
  .object({ cldbid: dbIdSchema, client_description: z.string().max(200) })
  .strict();

export const TempPasswordAddArgs = z
  .object({
    pw: z.string().min(1).max(TEMP_PASSWORD_MAX),
    desc: z.string().max(TEMP_PASSWORD_DESC_MAX),
    /** Seconds; the server refuses 0. */
    duration: z
      .number()
      .int()
      .min(1)
      .max(10 * 365 * 24 * 3600),
    /** Channel the password's users land in (and its password); none when left out. */
    tcid: dbIdSchema.optional(),
    tcpw: z.string().max(TEMP_PASSWORD_MAX).optional(),
  })
  .strict();
export const TempPasswordDelArgs = z
  .object({ pw: z.string().min(1).max(TEMP_PASSWORD_MAX) })
  .strict();
