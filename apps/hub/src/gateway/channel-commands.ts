/**
 * Wire form of the M2 channel commands (see
 * packages/protocol/src/ts-channel-commands.ts for the arguments and what a
 * live server accepts). Spread into the builder table in commands.ts.
 */
import { createHash } from "node:crypto";
import type { TsCmdArgs } from "@jinz/protocol";
import { buildTsCommand, wireParams, type PreparedCommand } from "./commands.js";

const plain = (text: string): PreparedCommand => ({ text, collect: null });

/**
 * The client protocol never carries a channel password in the clear: it is
 * base64(sha1(password)), for joining (`clientmove cpw=`, the handshake's
 * default channel) and for setting one alike. Checked on a live TS3 3.13
 * server: a channel created with `channel_password=<plain>` let in only a
 * join that sent the plain text as its hash, so neither this client nor the
 * TeamSpeak client (which hashes) could enter it; created with the hash, the
 * usual hashed join works. An empty password stays empty: it removes it.
 */
export const channelPasswordHash = (pw: string) =>
  pw ? createHash("sha1").update(pw).digest("base64") : "";

/** The channel properties with the password, if any, hashed. */
function hashedPassword<T extends { channel_password?: string }>(a: T): T {
  return a.channel_password === undefined
    ? a
    : { ...a, channel_password: channelPasswordHash(a.channel_password) };
}

/** TeamSpeak stores permission values as int32; icon ids (CRC32) above that wrap. */
function int32(value: number): number {
  return value > 0x7fffffff ? value - 0x1_0000_0000 : value;
}

export const CHANNEL_BUILDERS = {
  channelcreate: (a: TsCmdArgs<"channelcreate">) =>
    plain(buildTsCommand("channelcreate", wireParams(hashedPassword(a)))),
  channeledit: (a: TsCmdArgs<"channeledit">) =>
    plain(buildTsCommand("channeledit", wireParams(hashedPassword(a)))),
  channeldelete: (a: TsCmdArgs<"channeldelete">) =>
    plain(buildTsCommand("channeldelete", wireParams(a))),
  channelmove: (a: TsCmdArgs<"channelmove">) => plain(buildTsCommand("channelmove", wireParams(a))),
  channeladdperm: (a: TsCmdArgs<"channeladdperm">) =>
    plain(buildTsCommand("channeladdperm", wireParams({ ...a, permvalue: int32(a.permvalue) }))),
  channeldelperm: (a: TsCmdArgs<"channeldelperm">) =>
    plain(buildTsCommand("channeldelperm", wireParams(a))),
};
