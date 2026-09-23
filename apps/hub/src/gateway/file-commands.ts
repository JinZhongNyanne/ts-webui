/**
 * Wire form of the read-only file commands (M3, arguments in
 * packages/protocol/src/ts-file-commands.ts), spread into the builder table in
 * commands.ts, and the messages for TeamSpeak's file error ids, which the
 * file routes (files/errors.ts) use too.
 *
 * As a live TS3 3.13 server answered them: `ftgetfilelist` with
 * `notifyfilelist` rows (then `notifyfilelistfinished`, then the error line;
 * an empty directory is 1281, which runTsCmd turns into no rows), and
 * `ftgetfileinfo` with one `notifyfileinfo` row. Both want the channel
 * password hashed, like `clientmove`, and the `cpw` field even when empty.
 *
 * The file browser's commands answer with just the error line, and the
 * server tells no one else (scripts/verify-m3-file-browser.mjs): `ftcreatedir`
 * (2050 when it exists, 2052 without its parent), `ftrenamefile` (2052 when
 * the source is missing; onto an existing name it silently REPLACES that
 * file, so the page checks first; `tcpw` is hashed like `cpw`), and
 * `ftdeletefile` (rows run in order and the first missing path, 2054, ends
 * the command). Refusals name i_ft_needed_directory_create_power,
 * i_ft_needed_file_rename_power and i_ft_needed_file_delete_power.
 */
import type { TsCmdArgs } from "@jinz/protocol";
import { buildTsCommand, type PreparedCommand } from "./commands.js";
import { channelPasswordHash } from "./channel-commands.js";

export const FILE_BUILDERS = {
  ftgetfilelist: (a: TsCmdArgs<"ftgetfilelist">): PreparedCommand => ({
    text: buildTsCommand("ftgetfilelist", {
      cid: a.cid,
      cpw: channelPasswordHash(a.cpw ?? ""),
      path: a.path,
    }),
    collect: "notifyfilelist",
  }),
  ftgetfileinfo: (a: TsCmdArgs<"ftgetfileinfo">): PreparedCommand => ({
    text: buildTsCommand("ftgetfileinfo", {
      cid: a.cid,
      cpw: channelPasswordHash(a.cpw ?? ""),
      name: a.name,
    }),
    collect: "notifyfileinfo",
  }),
  // M3 file browser: plain answers (just the error line).
  ftcreatedir: (a: TsCmdArgs<"ftcreatedir">): PreparedCommand => ({
    text: buildTsCommand("ftcreatedir", {
      cid: a.cid,
      cpw: channelPasswordHash(a.cpw ?? ""),
      dirname: a.dirname,
    }),
    collect: null,
  }),
  // The target pair only for a move to another channel; its password is hashed too.
  ftrenamefile: (a: TsCmdArgs<"ftrenamefile">): PreparedCommand => ({
    text: buildTsCommand("ftrenamefile", {
      cid: a.cid,
      cpw: channelPasswordHash(a.cpw ?? ""),
      ...(a.tcid !== undefined ? { tcid: a.tcid, tcpw: channelPasswordHash(a.tcpw ?? "") } : {}),
      oldname: a.oldname,
      newname: a.newname,
    }),
    collect: null,
  }),
  ftdeletefile: (a: TsCmdArgs<"ftdeletefile">): PreparedCommand => ({
    text: buildTsCommand(
      "ftdeletefile",
      { cid: a.cid, cpw: channelPasswordHash(a.cpw ?? "") },
      a.names.map((name) => ({ name })),
    ),
    collect: null,
  }),
};

/** TeamSpeak's file error ids (0x800 range) worth their own message. */
export const FT_ERROR_KEYS: Record<string, string> = {
  "2048": "tsErr.fileInvalidName",
  "2050": "tsErr.fileExists",
  "2051": "tsErr.fileNotFound",
  "2052": "tsErr.fileIo",
  "2054": "tsErr.fileInvalidPath",
  "2057": "tsErr.fileInvalidSize",
  "2058": "tsErr.fileInUse",
  "2059": "tsErr.ftConnection",
  "2060": "tsErr.ftNoSpace",
  "2063": "tsErr.ftConnectionLost",
  "2068": "tsErr.ftServerQuota",
  "2069": "tsErr.ftClientQuota",
  "2071": "tsErr.ftLimitReached",
};
