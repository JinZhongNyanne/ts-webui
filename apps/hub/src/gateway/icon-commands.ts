/**
 * Wire form of the M3 icon and avatar commands (arguments in
 * packages/protocol/src/ts-icon-commands.ts), spread into the builder table
 * in commands.ts. Forms as a live TS3 3.13 server took them:
 *
 *  - `*addperm permsid=i_icon_id permvalue=<int32>`: an icon id above 2^31
 *    goes negative, as permissions store it. The server tells everyone:
 *    notifyservergrouplist / notifychannelgrouplist (the whole list),
 *    notifychanneledited channel_icon_id, notifyclientupdated client_icon_id.
 *  - `ftdeletefile cid=0 cpw= name=/icon_<unsigned id>`, and for avatars
 *    `name=/avatar_<base64 UID>` (see ts-internal-files.ts).
 */
import {
  TS_CMD_HUB_CODES,
  avatarDeleteName,
  iconFilePath,
  iconPermValue,
  type TsCmdArgs,
  type TsCmdRequest,
} from "@jinz/protocol";
import {
  buildTsCommand,
  TsCommandRefused,
  wireParams,
  type BuildContext,
  type PreparedCommand,
} from "./commands.js";

const plain = (text: string): PreparedCommand => ({ text, collect: null });
/** Group permissions carry these two flags; a live server took them as sent. */
const GROUP_FLAGS = { permnegated: "0", permskip: "0" };

const internalDelete = (name: string) =>
  plain(buildTsCommand("ftdeletefile", { cid: "0", cpw: "", name }));

export const ICON_BUILDERS = {
  servergroupaddperm: (a: TsCmdArgs<"servergroupaddperm">) =>
    plain(
      buildTsCommand("servergroupaddperm", {
        ...wireParams({ ...a, permvalue: iconPermValue(a.permvalue) }),
        ...GROUP_FLAGS,
      }),
    ),
  servergroupdelperm: (a: TsCmdArgs<"servergroupdelperm">) =>
    plain(buildTsCommand("servergroupdelperm", wireParams(a))),
  channelgroupaddperm: (a: TsCmdArgs<"channelgroupaddperm">) =>
    plain(
      buildTsCommand("channelgroupaddperm", {
        ...wireParams({ ...a, permvalue: iconPermValue(a.permvalue) }),
        ...GROUP_FLAGS,
      }),
    ),
  channelgroupdelperm: (a: TsCmdArgs<"channelgroupdelperm">) =>
    plain(buildTsCommand("channelgroupdelperm", wireParams(a))),
  // Client permissions have no negate flag.
  clientaddperm: (a: TsCmdArgs<"clientaddperm">) =>
    plain(
      buildTsCommand("clientaddperm", {
        ...wireParams({ ...a, permvalue: iconPermValue(a.permvalue) }),
        permskip: "0",
      }),
    ),
  clientdelperm: (a: TsCmdArgs<"clientdelperm">) =>
    plain(buildTsCommand("clientdelperm", wireParams(a))),
  ftdeleteicon: (a: TsCmdArgs<"ftdeleteicon">) => internalDelete(iconFilePath(a.iconId)),
  ftdeleteavatar: (_a: TsCmdArgs<"ftdeleteavatar">, ctx: BuildContext) => {
    const name = avatarDeleteName(ctx.selfUid);
    if (!name) throw new TsCommandRefused(TS_CMD_HUB_CODES.notConnected, "tsErr.notConnected");
    return internalDelete(name);
  },
};

/**
 * The channel-0 file a successful command changed, which the hub-wide asset
 * cache must drop (an avatar is cached by its hash, so it needs nothing).
 */
export function changedAssetPath(req: TsCmdRequest): string | null {
  return req.cmd === "ftdeleteicon" ? iconFilePath(req.args.iconId) : null;
}
