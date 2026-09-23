/**
 * Runs the browser's allow-listed TeamSpeak commands (`ts.cmd`).
 *
 * The browser only ever names a command and hands over typed arguments (see
 * packages/protocol/src/ts-commands.ts); the command text is built here, with
 * every value escaped, so no field can smuggle in a second parameter or a
 * second row. Failures come back as TeamSpeak error ids plus a text code the
 * web client translates.
 */
import { CommandTimeoutError, ServerError } from "@honeybbq/teamspeak-client";
import { escape, unescape } from "@honeybbq/teamspeak-client/command";
import {
  banIpProblem,
  banNameProblem,
  encodeTextCode,
  sameIp,
  TS_CMD_HUB_CODES,
  TsCmdIdSchema,
  type TsCmdArgs,
  type TsCmdName,
  type TsCmdRequest,
  type TsCmdResult,
  type TsCmdRow,
} from "@jinz/protocol";
import { catalogRows, type PermCatalog } from "./perms.js";
import { GuardBusyError, type ServerGuard } from "./server-guard.js";
// Circular on purpose: channel-commands.ts uses buildTsCommand / wireParams at
// call time only, so importing it from here (the entry point) is safe.
import { CHANNEL_BUILDERS, channelPasswordHash } from "./channel-commands.js";
import { FILE_BUILDERS, FT_ERROR_KEYS } from "./file-commands.js";
import { changedAssetPath, ICON_BUILDERS } from "./icon-commands.js";

type Params = Record<string, string>;

/**
 * Server-side timeout for a browser-issued `ts.cmd`, the wait for a slot in
 * the hub-wide budget included: under the page's own 10 s, so the page sees
 * our answer rather than its timer.
 */
export const TS_CMD_TIMEOUT_MS = 8_000;

/** A command the hub itself declines to send; `message` is a text code. */
export class TsCommandRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TsCommandRefused";
  }
}

/**
 * NUL and DEL are the two characters the library's escaping passes through
 * as they are. A NUL ends a command line on the wire (see raw.ts), so what
 * follows it could be read as a command of its own; neither belongs in any
 * text a page sends. Refused rather than stripped, so nothing is changed
 * behind the user's back.
 */
const UNESCAPED_CONTROL = /[\x00\x7f]/;

/** Throws TsCommandRefused for a text the escaping cannot carry safely (see above). */
export function checkCommandText(value: string): void {
  if (UNESCAPED_CONTROL.test(value)) {
    throw new TsCommandRefused(TS_CMD_HUB_CODES.badArgs, "tsErr.controlChars");
  }
}

/**
 * Builds `name k=v k=v|k=v|k=v`: `shared` goes on the first row, each entry of
 * `rows` is one pipe-separated row after it. Keys are ours; values are escaped.
 */
export function buildTsCommand(name: string, shared: Params = {}, rows: Params[] = []): string {
  for (const p of [shared, ...rows]) Object.values(p).forEach(checkCommandText);
  const pairs = (p: Params) => Object.entries(p).map(([k, v]) => `${k}=${escape(v)}`);
  const first = [name, ...pairs(shared), ...pairs(rows[0] ?? {})].join(" ");
  return [first, ...rows.slice(1).map((r) => pairs(r).join(" "))].join("|");
}

const flag = (v: boolean) => (v ? "1" : "0");

/** Drops unset fields and turns booleans into TeamSpeak's 1/0. */
export function wireParams(args: Record<string, string | number | boolean | undefined>): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    out[k] = typeof v === "boolean" ? flag(v) : String(v);
  }
  return out;
}

/** What goes on the wire for one command, and which notify carries its answer. */
export interface PreparedCommand {
  text: string;
  /**
   * In the client protocol most list commands answer with a notification
   * (`servergrouplist` -> `notifyservergrouplist`) rather than plain rows;
   * this names the one to collect until the command's `error` line.
   */
  collect: string | null;
  /**
   * For commands answered with plain rows: the key the answer starts with,
   * whose value the client library leaves escaped (see repairDirectRows).
   */
  firstField?: string;
}

/** What a few builders need to know about the session (the caller's own avatar). */
export interface BuildContext {
  /** Our UID; "" until the server has told us. */
  selfUid: string;
}

type Builders = {
  [C in TsCmdName]: (args: TsCmdArgs<C>, ctx: BuildContext) => PreparedCommand;
};

const plain = (text: string): PreparedCommand => ({ text, collect: null });
const cidRows = (cids: readonly string[]) => cids.map((cid) => ({ cid }));
const listed = (text: string, collect: string): PreparedCommand => ({ text, collect });

/** Appends TeamSpeak option flags (`-count`, `-uid`) for the ones set; names are ours. */
function withFlags(text: string, flags: Record<string, boolean | undefined>): string {
  const set = Object.keys(flags).filter((k) => flags[k]);
  return [text, ...set.map((k) => `-${k}`)].join(" ");
}

/* ------------------------------------------------------ M4 server admin */

/** Only regular groups are made here (see ts-commands-server.ts). */
const REGULAR_GROUP = "1";

/**
 * Wire forms of the M4 server administration commands, with the notify each
 * list answers with, as a live TS3 3.13 server sent them. Group changes need
 * no collector: the server follows each one with the whole group list
 * (`notifyservergrouplist` / `notifychannelgrouplist`), which replaces the
 * session's own (group-list.ts), so a deleted group leaves every page's
 * lists with it. `logview` is always the virtual server's log: the instance
 * log belongs to whoever runs the host.
 */
const SERVER_BUILDERS = {
  privilegekeyuse: (a: TsCmdArgs<"privilegekeyuse">) =>
    plain(buildTsCommand("privilegekeyuse", wireParams(a))),
  privilegekeylist: () => listed("privilegekeylist", "notifytokenlist"),
  // A server group key still wants its (empty) channel: tokenid2=0.
  privilegekeyadd: (a: TsCmdArgs<"privilegekeyadd">) =>
    listed(
      buildTsCommand(
        "privilegekeyadd",
        wireParams({
          tokentype: a.tokentype,
          tokenid1: a.tokenid1,
          tokenid2: a.tokenid2 ?? "0",
          tokendescription: a.tokendescription,
        }),
      ),
      "notifytokenadd",
    ),
  privilegekeydelete: (a: TsCmdArgs<"privilegekeydelete">) =>
    plain(buildTsCommand("privilegekeydelete", wireParams(a))),
  servergroupadd: (a: TsCmdArgs<"servergroupadd">) =>
    plain(buildTsCommand("servergroupadd", { name: a.name, type: REGULAR_GROUP })),
  servergroupdel: (a: TsCmdArgs<"servergroupdel">) =>
    plain(buildTsCommand("servergroupdel", wireParams(a))),
  servergrouprename: (a: TsCmdArgs<"servergrouprename">) =>
    plain(buildTsCommand("servergrouprename", wireParams(a))),
  servergroupcopy: (a: TsCmdArgs<"servergroupcopy">) =>
    plain(
      buildTsCommand("servergroupcopy", {
        ssgid: a.ssgid,
        tsgid: "0",
        name: a.name,
        type: REGULAR_GROUP,
      }),
    ),
  channelgroupadd: (a: TsCmdArgs<"channelgroupadd">) =>
    plain(buildTsCommand("channelgroupadd", { name: a.name, type: REGULAR_GROUP })),
  channelgroupdel: (a: TsCmdArgs<"channelgroupdel">) =>
    plain(buildTsCommand("channelgroupdel", wireParams(a))),
  channelgrouprename: (a: TsCmdArgs<"channelgrouprename">) =>
    plain(buildTsCommand("channelgrouprename", wireParams(a))),
  channelgroupcopy: (a: TsCmdArgs<"channelgroupcopy">) =>
    plain(
      buildTsCommand("channelgroupcopy", {
        scgid: a.scgid,
        tcgid: "0",
        name: a.name,
        type: REGULAR_GROUP,
      }),
    ),
  serveredit: (a: TsCmdArgs<"serveredit">) => plain(buildTsCommand("serveredit", wireParams(a))),
  servergetvariables: () => listed("servergetvariables", "notifyserverupdated"),
  logview: (a: TsCmdArgs<"logview">) =>
    listed(
      buildTsCommand(
        "logview",
        wireParams({
          lines: a.lines,
          reverse: a.reverse,
          instance: false,
          begin_pos: a.begin_pos,
        }),
      ),
      "notifyserverlog",
    ),
  serverrequestconnectioninfo: () =>
    listed("serverrequestconnectioninfo", "notifyserverconnectioninfo"),
};

/** TeamSpeak errors the M4 windows run into often enough to deserve their own words. */
const SERVER_ERROR_KEYS: Record<string, string> = {
  "1282": "server.err.duplicate",
  "2560": "server.err.invalidGroup",
  "2567": "server.err.groupNotEmpty",
  "2817": "server.err.maxSlots",
  "3840": "server.err.invalidKey",
};

/**
 * The permission catalog as the page gets it: one row per permission (ids
 * included, see catalogRows), then one `group_id_end` row per category, the
 * way TeamSpeak's own list marks them, so the permission overview can group
 * by category without the hub inventing names for them. The markers come
 * last so the permission rows keep their positions.
 */
export function catalogAnswer(catalog: PermCatalog): TsCmdRow[] {
  const ends = catalog.groupEnds.map((end) => ({ group_id_end: String(end) }));
  return [...catalogRows(catalog), ...ends];
}

const BUILDERS: Builders = {
  clientupdate: (a) => plain(buildTsCommand("clientupdate", wireParams(a))),
  clientedit: (a) => plain(buildTsCommand("clientedit", wireParams(a))),
  channelsubscribe: (a) => plain(buildTsCommand("channelsubscribe", {}, cidRows(a.cids))),
  channelunsubscribe: (a) => plain(buildTsCommand("channelunsubscribe", {}, cidRows(a.cids))),
  channelsubscribeall: () => plain("channelsubscribeall"),
  channelunsubscribeall: () => plain("channelunsubscribeall"),
  // Served from the hub-wide catalog (see runTsCmd); this is how it is fetched.
  permissionlist: () => ({ text: "permissionlist", collect: "notifypermissionlist" }),
  servergrouplist: () => ({ text: "servergrouplist", collect: "notifyservergrouplist" }),
  channelgrouplist: () => ({ text: "channelgrouplist", collect: "notifychannelgrouplist" }),
  permoverview: (a) => {
    // permid=0 asks for every permission.
    const ids = a.permids?.length ? a.permids : [0];
    return {
      text: buildTsCommand(
        "permoverview",
        { cid: a.cid, cldbid: a.cldbid },
        ids.map((id) => ({ permid: String(id) })),
      ),
      collect: "notifypermoverview",
    };
  },
  clientpermlist: (a) => ({
    text: buildTsCommand("clientpermlist", { cldbid: a.cldbid }),
    collect: "notifyclientpermlist",
  }),
  ...CHANNEL_BUILDERS,
  // M2 moderation
  clientmove: ({ cpw, ...a }) =>
    plain(
      buildTsCommand("clientmove", {
        ...wireParams(a),
        ...(cpw ? { cpw: channelPasswordHash(cpw) } : {}),
      }),
    ),
  clientkick: (a) => plain(buildTsCommand("clientkick", wireParams(a))),
  servergroupaddclient: (a) => plain(buildTsCommand("servergroupaddclient", wireParams(a))),
  servergroupdelclient: (a) => plain(buildTsCommand("servergroupdelclient", wireParams(a))),
  setclientchannelgroup: (a) => plain(buildTsCommand("setclientchannelgroup", wireParams(a))),
  banclient: (a) => plain(buildTsCommand("banclient", wireParams(a))),
  banadd: (a) => plain(buildTsCommand("banadd", wireParams(a))),
  banlist: () => ({ text: "banlist", collect: "notifybanlist" }),
  bandel: (a) => plain(buildTsCommand("bandel", wireParams(a))),
  bandelall: () => plain("bandelall"),
  // M2 admin tools. Notify names as a live TS3 server answered them.
  complainadd: (a) => plain(buildTsCommand("complainadd", wireParams(a))),
  complainlist: (a) => listed(buildTsCommand("complainlist", wireParams(a)), "notifycomplainlist"),
  complaindel: (a) => plain(buildTsCommand("complaindel", wireParams(a))),
  complaindelall: (a) => plain(buildTsCommand("complaindelall", wireParams(a))),
  messagelist: () => listed("messagelist", "notifymessagelist"),
  messageget: (a) => listed(buildTsCommand("messageget", wireParams(a)), "notifymessage"),
  messageupdateflag: (a) => plain(buildTsCommand("messageupdateflag", wireParams(a))),
  messagedel: (a) => plain(buildTsCommand("messagedel", wireParams(a))),
  messageadd: (a) => plain(buildTsCommand("messageadd", wireParams(a))),
  // One row per UID; a live server answers each with its own notify.
  clientgetnamefromuid: (a) =>
    listed(
      buildTsCommand(
        "clientgetnamefromuid",
        {},
        a.cluids.map((cluid) => ({ cluid })),
      ),
      "notifyclientnamefromuid",
    ),
  clientdblist: ({ count, ...a }) =>
    listed(
      withFlags(buildTsCommand("clientdblist", wireParams(a)), { count }),
      "notifyclientdblist",
    ),
  clientdbfind: ({ uid, ...a }) =>
    listed(withFlags(buildTsCommand("clientdbfind", wireParams(a)), { uid }), "notifyclientdbfind"),
  // Unlike the list commands, this one answers with plain rows, one per id.
  clientdbinfo: (a) => ({
    ...plain(
      buildTsCommand(
        "clientdbinfo",
        {},
        a.cldbids.map((cldbid) => ({ cldbid })),
      ),
    ),
    firstField: "client_unique_identifier",
  }),
  clientdbedit: (a) => plain(buildTsCommand("clientdbedit", wireParams(a))),
  clientdbdelete: (a) => plain(buildTsCommand("clientdbdelete", wireParams(a))),
  servertemppasswordlist: () => listed("servertemppasswordlist", "notifyservertemppasswordlist"),
  // The server wants the channel pair even without a channel: tcid=0 means none.
  // Unlike `clientmove cpw=`, tcpw is the channel password in clear: with its
  // SHA-1 (as clientmove wants) a live server put the user in the default channel.
  servertemppasswordadd: (a) =>
    plain(
      buildTsCommand(
        "servertemppasswordadd",
        wireParams({ ...a, tcid: a.tcid ?? "0", tcpw: a.tcpw ?? "" }),
      ),
    ),
  servertemppassworddel: (a) => plain(buildTsCommand("servertemppassworddel", wireParams(a))),
  ...FILE_BUILDERS,
  ...ICON_BUILDERS,
  ...SERVER_BUILDERS,
};

/**
 * The client library reads a plain answer line (`k=v k=v|k=v…`, no command
 * name) as a command named after its first `k=v` and keeps that value
 * escaped: `clientdbinfo` came back with `client_unique_identifier=ab\/c=`.
 * Later rows repeat the key in their own (unescaped) fields, which win, so
 * only the first row's first field needs it, and only when it is the field
 * the answer should start with (`firstField`): a first field sent without a
 * value is dropped by the library, and the next one is already unescaped.
 */
export function repairDirectRows(rows: readonly TsCmdRow[], firstField?: string): TsCmdRow[] {
  const [first, ...rest] = rows;
  if (!first) return [];
  if (!firstField || Object.keys(first)[0] !== firstField) return [first, ...rest];
  return [{ ...first, [firstField]: unescape(first[firstField] ?? "") }, ...rest];
}

export function prepareTsCommand(
  req: TsCmdRequest,
  ctx: BuildContext = { selfUid: "" },
): PreparedCommand {
  // The union and the table are keyed alike; TS cannot correlate the two on its own.
  const build = BUILDERS[req.cmd] as (
    args: TsCmdRequest["args"],
    ctx: BuildContext,
  ) => PreparedCommand;
  return build(req.args, ctx);
}

/** A TeamSpeak `error id≠0` answer, with the permission it names when it is a 2568. */
export class TsCommandFailure extends Error {
  constructor(
    readonly id: string,
    readonly serverMessage: string,
    readonly failedPermId: number | null,
  ) {
    super(`TeamSpeak error ${id}: ${serverMessage}`);
    this.name = "TsCommandFailure";
  }
}

/** What runTsCmd needs from a TsSession (an interface so tests can fake it). */
export interface TsCommandTarget {
  runCommand(prepared: PreparedCommand, timeoutMs?: number): Promise<TsCmdRow[]>;
  permissionCatalog(): Promise<PermCatalog>;
  /** The server's guard (server-guard.ts): the hub-wide budget and what the hub is there. */
  readonly guard?: Pick<ServerGuard, "tsCmdSlot" | "isHubClient" | "hubAddress">;
  /** Our UID, for the commands that act on our own avatar. */
  readonly selfUid?: string;
  /** Drops a channel-0 file from the hub-wide asset cache after a command changed it. */
  forgetAsset?(path: string): void;
}

/** Where runTsCmd reports failures nobody expected (the page only hears "failed"). */
export interface FailureLog {
  warn(obj: object, msg: string): void;
}

const refuse = (code: string, message: string) => new TsCommandRefused(code, message);

/**
 * Bans that would not stop at one person. Every web user reaches the server
 * from the hub's address: `banclient` bans a client's IP as well as its UID,
 * so on one of our sessions it bans all of them; so does an IP rule on that
 * address. Nickname rules are checked for breadth and cost (ban-rules.ts).
 * While no session has learned the hub's address, IP rules pass on the
 * literal-address check alone.
 */
export function banRefusal(
  req: TsCmdRequest,
  guard?: TsCommandTarget["guard"],
): TsCommandRefused | null {
  const shared = () => refuse(TS_CMD_HUB_CODES.sharedAddress, "tsErr.banSharedAddress");
  if (req.cmd === "banclient") return guard?.isHubClient(req.args.clid) ? shared() : null;
  if (req.cmd !== "banadd") return null;
  const { ip, name } = req.args;
  if (ip !== undefined) {
    const problem = banIpProblem(ip);
    if (problem) return refuse(TS_CMD_HUB_CODES.badBanRule, problem);
    const hub = guard?.hubAddress;
    if (hub && sameIp(ip, hub)) return shared();
  }
  if (name !== undefined) {
    const problem = banNameProblem(name);
    if (problem) return refuse(TS_CMD_HUB_CODES.badBanRule, problem);
  }
  return null;
}

/** TeamSpeak's "database empty result set": a list with nothing in it, not a failure. */
const TS_EMPTY_RESULT = "1281";

const TS_NO_PERMISSION = "2568";

/** Error ids common enough to deserve their own message; the rest show the server's text. */
const TS_ERROR_KEYS: Record<string, string> = {
  "256": "tsErr.unknownCommand",
  "512": "tsErr.invalidClient",
  "513": "tsErr.nicknameInUse",
  "768": "tsErr.invalidChannel",
  "770": "tsErr.alreadyInChannel",
  "771": "tsErr.channelNameInUse",
  "772": "tsErr.channelNotEmpty",
  "774": "tsErr.defaultNeedsPermanent",
  "776": "tsErr.permanentUnderTemporary",
  "781": "tsErr.channelPassword",
  "1538": "tsErr.invalidParameter",
  "1540": "tsErr.conversion",
  "1541": "tsErr.parameterSize",
  "2561": "tsErr.groupDuplicate",
  [TS_NO_PERMISSION]: "tsErr.insufficientPermissions",
  "3328": "tsErr.invalidBanId",
  "3331": "tsErr.flood",
  ...FT_ERROR_KEYS,
  ...SERVER_ERROR_KEYS,
};

type Failure = Extract<TsCmdResult, { ok: false }>;

/** Turns whatever a command threw into a `ts.cmdResult` failure. */
export function describeTsFailure(id: string, err: unknown, catalog?: PermCatalog): Failure {
  const base = { type: "ts.cmdResult", id, ok: false } as const;
  if (err instanceof TsCommandFailure || err instanceof ServerError) {
    const failedPermId = err instanceof TsCommandFailure ? err.failedPermId : null;
    const failedPermission =
      failedPermId !== null ? (catalog?.byId.get(failedPermId) ?? `#${failedPermId}`) : undefined;
    const key = TS_ERROR_KEYS[err.id];
    let message: string;
    if (err.id === TS_NO_PERMISSION && failedPermission) {
      message = encodeTextCode("tsErr.missingPermission", { perm: failedPermission });
    } else if (key) {
      message = key;
    } else {
      message = encodeTextCode("tsErr.generic", { id: err.id, msg: err.serverMessage });
    }
    return { ...base, code: err.id, message, ...(failedPermission ? { failedPermission } : {}) };
  }
  if (err instanceof CommandTimeoutError) {
    return { ...base, code: TS_CMD_HUB_CODES.timeout, message: "tsErr.timeout" };
  }
  if (err instanceof TsCommandRefused) return { ...base, code: err.code, message: err.message };
  if (err instanceof GuardBusyError) {
    return { ...base, code: TS_CMD_HUB_CODES.rateLimited, message: "tsErr.hubBusy" };
  }
  // Anything else is ours (a bug, a socket error): its text is for the log only.
  return { ...base, code: TS_CMD_HUB_CODES.failed, message: "tsErr.failed" };
}

/** Whether describeTsFailure has a proper answer for `err` (the rest get logged). */
function isExpectedFailure(err: unknown): boolean {
  return (
    err instanceof TsCommandFailure ||
    err instanceof ServerError ||
    err instanceof CommandTimeoutError ||
    err instanceof TsCommandRefused ||
    err instanceof GuardBusyError
  );
}

/**
 * Checks, builds and sends one command. Refusals come first, so a command the
 * hub will not send never spends the hub-wide budget; the wait for a slot
 * comes out of the time the server gets.
 */
async function sendTsCmd(target: TsCommandTarget, req: TsCmdRequest): Promise<TsCmdRow[]> {
  if (req.cmd === "permissionlist") return catalogAnswer(await target.permissionCatalog());
  const refusal = banRefusal(req, target.guard);
  if (refusal) throw refusal;
  const prepared = prepareTsCommand(req, { selfUid: target.selfUid ?? "" });
  const waited = (await target.guard?.tsCmdSlot()) ?? 0;
  const rows = await target.runCommand(prepared, TS_CMD_TIMEOUT_MS - waited);
  const changed = changedAssetPath(req);
  if (changed) target.forgetAsset?.(changed);
  return rows;
}

/** Runs one validated `ts.cmd` and always resolves with the reply for the browser. */
export async function runTsCmd(
  target: TsCommandTarget,
  req: TsCmdRequest,
  log?: FailureLog,
): Promise<TsCmdResult> {
  try {
    const rows = await sendTsCmd(target, req);
    return { type: "ts.cmdResult", id: req.id, ok: true, rows };
  } catch (err) {
    const isFailure = err instanceof TsCommandFailure || err instanceof ServerError;
    if (isFailure && err.id === TS_EMPTY_RESULT) {
      return { type: "ts.cmdResult", id: req.id, ok: true, rows: [] };
    }
    // Naming the missing permission is worth a catalog lookup, which is
    // cached; if even that fails the id alone still goes out.
    let catalog: PermCatalog | undefined;
    if (err instanceof TsCommandFailure && err.failedPermId !== null) {
      catalog = await target.permissionCatalog().catch(() => undefined);
    }
    if (!isExpectedFailure(err)) log?.warn({ err, cmd: req.cmd }, "ts.cmd failed unexpectedly");
    return describeTsFailure(req.id, err, catalog);
  }
}

/**
 * The request id of something that looks like a `ts.cmd`, even one that failed
 * validation, so the browser's promise can be failed at once instead of
 * waiting out its timeout. Null when there is no usable id.
 */
export function tsCmdIdOf(parsed: unknown): string | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const { type, id } = parsed as { type?: unknown; id?: unknown };
  if (type !== "ts.cmd") return null;
  return TsCmdIdSchema.safeParse(id).success ? (id as string) : null;
}

/** A failure the hub itself decided on (not connected, over the limit, bad arguments). */
export function hubTsFailure(id: string, code: string, message: string): TsCmdResult {
  return { type: "ts.cmdResult", id, ok: false, code, message };
}
