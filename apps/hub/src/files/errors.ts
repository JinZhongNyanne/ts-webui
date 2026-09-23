/**
 * What the file routes answer when a transfer cannot happen: an HTTP status
 * and an FtErrorBody whose message is a text code the page translates.
 *
 * TeamSpeak's refusals get the same messages as `ts.cmd` failures
 * (describeTsFailure, including the permission a 2568 was about); the status
 * only has to be right enough for the page and the browser's download UI.
 */
import { CommandTimeoutError, ServerError } from "@honeybbq/teamspeak-client";
import { FT_HUB_CODES, TS_CMD_HUB_CODES, type FtErrorBody } from "@jinz/protocol";
import { describeTsFailure, TsCommandFailure, TsCommandRefused } from "../gateway/commands.js";
import { GuardBusyError } from "../gateway/server-guard.js";
import type { PermCatalog } from "../gateway/perms.js";
import { FtInitTimeout } from "./ft-waiters.js";

/** A refusal the hub decides on itself; `message` is a text code. */
export class FtRefused extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FtRefused";
  }
}

export interface FtErrorReply {
  status: number;
  body: FtErrorBody;
}

/** HTTP status by TeamSpeak error id; anything else is the server's failure (502). */
const STATUS_BY_TS_ID: Record<string, number> = {
  "768": 404, // invalid channel
  "781": 403, // channel password
  "2568": 403, // permissions
  "2048": 400, // invalid name
  "2054": 400, // invalid path
  "2050": 409, // exists
  "2058": 409, // in use
  "2051": 404, // not found
  "2052": 404, // ftgetfileinfo's answer for a missing file
  "2068": 403, // server quota
  "2069": 403, // client quota
  "2071": 429, // transfer limit
  "3331": 429, // flood
};

const STATUS_BY_HUB_CODE: Record<string, number> = {
  [TS_CMD_HUB_CODES.notConnected]: 409,
  [TS_CMD_HUB_CODES.rateLimited]: 429,
  [TS_CMD_HUB_CODES.badArgs]: 400,
};

export function ftErrorReply(err: unknown, catalog?: PermCatalog): FtErrorReply {
  if (err instanceof FtRefused) {
    return { status: err.status, body: { error: err.code, message: err.message } };
  }
  if (err instanceof FtInitTimeout) {
    return { status: 504, body: { error: TS_CMD_HUB_CODES.timeout, message: "tsErr.timeout" } };
  }
  const known =
    err instanceof TsCommandFailure ||
    err instanceof TsCommandRefused ||
    err instanceof GuardBusyError ||
    err instanceof ServerError ||
    err instanceof CommandTimeoutError;
  if (!known) return { status: 502, body: { error: FT_HUB_CODES.failed, message: "ft.failed" } };
  const failure = describeTsFailure("", err, catalog);
  const status =
    STATUS_BY_TS_ID[failure.code] ??
    STATUS_BY_HUB_CODE[failure.code] ??
    (failure.code === TS_CMD_HUB_CODES.timeout ? 504 : 502);
  return {
    status,
    body: {
      error: failure.code,
      message: failure.message,
      ...(failure.failedPermission ? { failedPermission: failure.failedPermission } : {}),
    },
  };
}
