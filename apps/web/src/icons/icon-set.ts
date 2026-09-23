/**
 * The server's icons and where they go. Uploaded icons are listed from
 * channel 0's `/icons` (which needs b_icon_manage); the ones already in use
 * (groups, channels, clients, the server) are known without it, so the
 * picker has something to offer either way.
 *
 * An icon is set as the `i_icon_id` permission of its target; the server
 * then tells everyone (see apps/hub/src/gateway/icon-commands.ts).
 */
import {
  iconIdFromFileName,
  isBuiltinIconId,
  type FtEntry,
  type TsCmdArgs,
  type TsCmdName,
} from "@jinz/protocol";

export type IconTarget =
  | { kind: "serverGroup"; id: string; name: string }
  | { kind: "channelGroup"; id: string; name: string }
  | { kind: "channel"; id: string; name: string }
  /** On the identity (database id): it follows them to their next visit. */
  | { kind: "client"; dbId: string; name: string };

export type IconTargetKind = IconTarget["kind"];

const byNumber = (a: number, b: number) => a - b;

/** Icon ids (unsigned) in an `/icons` listing, ascending. */
export function iconIdsFromListing(entries: readonly FtEntry[]): number[] {
  const ids = entries
    .filter((e) => !e.isDir)
    .map((e) => iconIdFromFileName(e.name))
    .filter((id): id is number => id !== null && !isBuiltinIconId(id));
  return [...new Set(ids)].sort(byNumber);
}

interface HasIcon {
  readonly iconId: number;
}

/** Uploaded icons in use anywhere we can see (unsigned, ascending). */
export function iconIdsInUse(state: {
  server?: HasIcon | null;
  serverGroups: Iterable<HasIcon>;
  channelGroups: Iterable<HasIcon>;
  channels: Iterable<HasIcon>;
  clients: Iterable<HasIcon>;
}): number[] {
  const all = [
    ...(state.server ? [state.server] : []),
    ...state.serverGroups,
    ...state.channelGroups,
    ...state.channels,
    ...state.clients,
  ];
  const ids = all.map((x) => x.iconId >>> 0).filter((id) => id !== 0 && !isBuiltinIconId(id));
  return [...new Set(ids)].sort(byNumber);
}

/** Where a target's current icon is read from (the ts store's maps). */
export interface IconState {
  serverGroups: ReadonlyMap<string, HasIcon>;
  channelGroups: ReadonlyMap<string, HasIcon>;
  channels: ReadonlyMap<string, HasIcon>;
  clients: Iterable<HasIcon & { readonly databaseId: string }>;
}

/** The target's icon (unsigned; 0 = none), or null when it is not in view. */
export function targetIconId(target: IconTarget, state: IconState): number | null {
  const found = (x: HasIcon | undefined) => (x ? x.iconId >>> 0 : null);
  switch (target.kind) {
    case "serverGroup":
      return found(state.serverGroups.get(target.id));
    case "channelGroup":
      return found(state.channelGroups.get(target.id));
    case "channel":
      return found(state.channels.get(target.id));
    case "client":
      return found([...state.clients].find((c) => c.databaseId === target.dbId));
  }
}

export function mergeIconIds(...lists: readonly (readonly number[])[]): number[] {
  return [...new Set(lists.flat())].sort(byNumber);
}

/** One allow-listed command, ready for tsCommand. */
export type IconCommand = {
  [C in TsCmdName]: { cmd: C; args: TsCmdArgs<C> };
}[TsCmdName];

const PERM = "i_icon_id" as const;

/** Sets `iconId` on `target`, or removes its icon (`null`). */
export function iconCommand(target: IconTarget, iconId: number | null): IconCommand {
  const set = iconId !== null;
  const value = { permsid: PERM, permvalue: iconId ?? 0 };
  switch (target.kind) {
    case "serverGroup":
      return set
        ? { cmd: "servergroupaddperm", args: { sgid: target.id, ...value } }
        : { cmd: "servergroupdelperm", args: { sgid: target.id, permsid: PERM } };
    case "channelGroup":
      return set
        ? { cmd: "channelgroupaddperm", args: { cgid: target.id, ...value } }
        : { cmd: "channelgroupdelperm", args: { cgid: target.id, permsid: PERM } };
    case "channel":
      return set
        ? { cmd: "channeladdperm", args: { cid: target.id, ...value } }
        : { cmd: "channeldelperm", args: { cid: target.id, permsid: PERM } };
    case "client":
      return set
        ? { cmd: "clientaddperm", args: { cldbid: target.dbId, ...value } }
        : { cmd: "clientdelperm", args: { cldbid: target.dbId, permsid: PERM } };
  }
}
