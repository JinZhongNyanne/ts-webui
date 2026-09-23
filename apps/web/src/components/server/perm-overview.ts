/**
 * The read-only permission overview: which of a client's groups, channel and
 * own settings give it each permission, and which of them wins. Pure, so the
 * rules are testable; the future permission editor builds on the same parts.
 *
 * Inputs are two `ts.cmd` answers:
 *  - `permissionlist`, as the hub serves it: `permid/permname/permdesc` rows,
 *    then `group_id_end` rows marking where each of TeamSpeak's categories
 *    ends (see catalogAnswer in the hub's commands.ts);
 *  - `permoverview` (notifypermoverview): one row per source, `t` the kind of
 *    source, `id1`/`id2` which one, `p` the permission id, `v` its value and
 *    `n`/`s` the negate and skip flags.
 */
import type { TsCmdRow } from "@jinz/protocol";

/** `t` in notifypermoverview. id1/id2 are, in turn: sgid; cldbid; cid; cgid+cid; cid+cldbid. */
export const SOURCE = {
  serverGroup: 0,
  client: 1,
  channel: 2,
  channelGroup: 3,
  channelClient: 4,
} as const;

export interface CatalogEntry {
  readonly id: number;
  readonly name: string;
  readonly desc: string;
}

export interface CatalogView {
  readonly entries: readonly CatalogEntry[];
  readonly byId: ReadonlyMap<number, CatalogEntry>;
  /** Last permission id of each category, in order; repeats mark empty categories. */
  readonly groupEnds: readonly number[];
}

const int = (v: string | undefined): number | null => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isInteger(n) ? n : null;
};

export function parseCatalog(rows: readonly TsCmdRow[]): CatalogView {
  const entries: CatalogEntry[] = [];
  const groupEnds: number[] = [];
  for (const r of rows) {
    const id = int(r["permid"]);
    if (id !== null && r["permname"]) {
      entries.push({ id, name: r["permname"], desc: r["permdesc"] ?? "" });
      continue;
    }
    const end = int(r["group_id_end"]);
    if (end !== null) groupEnds.push(end);
  }
  return { entries, byId: new Map(entries.map((e) => [e.id, e])), groupEnds };
}

export interface PermSourceRow {
  readonly kind: number;
  readonly id1: string;
  readonly id2: string;
  readonly permId: number;
  readonly value: number;
  readonly negated: boolean;
  readonly skip: boolean;
}

const KINDS: readonly number[] = Object.values(SOURCE);

export function parseOverview(rows: readonly TsCmdRow[]): PermSourceRow[] {
  return rows.flatMap((r) => {
    const kind = int(r["t"]);
    const permId = int(r["p"]);
    const value = int(r["v"]);
    if (kind === null || !KINDS.includes(kind) || permId === null || value === null) return [];
    return [
      {
        kind,
        id1: r["id1"] ?? "0",
        id2: r["id2"] ?? "0",
        permId,
        value,
        negated: r["n"] === "1",
        skip: r["s"] === "1",
      },
    ];
  });
}

export interface Resolution {
  readonly value: number | null;
  /** Index into the given sources of the one that decided the value. */
  readonly decisive: number | null;
}

/** Channel-level sources, in the order they override one another. */
const CHANNEL_LEVELS = [SOURCE.channel, SOURCE.channelGroup, SOURCE.channelClient];

/**
 * The channel levels `skip` keeps out. The server's own permissiondoc.txt
 * (tiers 1 and 2) says a skipped value "will not be altered by any
 * overlapping permission in the Channel Groups (Tier 4) or the Channel
 * (Tier 3) layer"; tier 5, the client's own permission in the channel, is
 * not named and still overrides it.
 */
const SKIPPED_LEVELS: readonly number[] = [SOURCE.channel, SOURCE.channelGroup];

/**
 * TeamSpeak's order, simplified: server groups first (the highest value, or
 * the lowest of the negated ones if any group negates it), then the client's
 * own permission overrides that, then the channel, the channel group and the
 * client's permission in that channel override in turn — unless a server
 * group or the client permission set `skip`, which keeps the channel and the
 * channel group out (but not the channel-client permission; see
 * SKIPPED_LEVELS). This explains the common cases; the server's own
 * evaluation stays the word that counts, which is why the window is read-only.
 */
export function resolvePermission(sources: readonly PermSourceRow[]): Resolution {
  const indexed = sources.map((s, i) => ({ s, i }));
  const groups = indexed.filter(({ s }) => s.kind === SOURCE.serverGroup);
  const negated = groups.filter(({ s }) => s.negated);
  const pool = negated.length ? negated : groups;
  let best: { s: PermSourceRow; i: number } | null = null;
  for (const g of pool) {
    const better = negated.length
      ? g.s.value < (best?.s.value ?? Infinity)
      : g.s.value > (best?.s.value ?? -Infinity);
    if (!best || better) best = g;
  }
  const client = indexed.find(({ s }) => s.kind === SOURCE.client);
  if (client) best = client;
  const skip = groups.some(({ s }) => s.skip) || !!client?.s.skip;
  for (const kind of CHANNEL_LEVELS) {
    if (skip && SKIPPED_LEVELS.includes(kind)) continue;
    const level = indexed.find(({ s }) => s.kind === kind);
    if (level) best = level;
  }
  return best ? { value: best.s.value, decisive: best.i } : { value: null, decisive: null };
}

/**
 * A readable name for one of TeamSpeak's categories, from what its
 * permissions' names share ("b_virtualserver_modify_name" and
 * "…_modify_welcomemessage" → "virtualserver modify"). TeamSpeak's own
 * category titles live in its client, not on the wire.
 */
export function categoryLabel(names: readonly string[]): string {
  const split = names.map((n) => n.split("_").slice(1));
  const first = split[0];
  if (!first) return "";
  let shared = 0;
  // Leave the last word out: it names the permission, not the category.
  while (
    shared < first.length - 1 &&
    split.every((parts) => parts.length - 1 > shared && parts[shared] === first[shared])
  ) {
    shared++;
  }
  return first.slice(0, Math.max(shared, 1)).join(" ");
}

export interface ExplainedSource extends PermSourceRow {
  readonly decisive: boolean;
}

export interface ExplainedPermission {
  readonly id: number;
  readonly name: string;
  readonly desc: string;
  readonly value: number | null;
  readonly sources: readonly ExplainedSource[];
}

export interface PermCategory {
  /** "" for permissions past the last category (or unknown to the catalog). */
  readonly label: string;
  readonly perms: readonly ExplainedPermission[];
}

/** The category index of a permission id: past the last end is one more. */
function categoryOf(id: number, ends: readonly number[]): number {
  const i = ends.findIndex((end) => id <= end);
  return i < 0 ? ends.length : i;
}

/**
 * The permissions the target has any source for, filtered by `query` (name or
 * description), grouped by category in the catalog's order.
 */
export function explainOverview(
  catalog: CatalogView,
  sources: readonly PermSourceRow[],
  query: string,
): PermCategory[] {
  const q = query.trim().toLowerCase();
  const byPerm = new Map<number, PermSourceRow[]>();
  for (const s of sources) byPerm.set(s.permId, [...(byPerm.get(s.permId) ?? []), s]);
  const ends = catalog.groupEnds;
  const buckets = new Map<number, ExplainedPermission[]>();
  for (const id of [...byPerm.keys()].sort((a, b) => a - b)) {
    const entry = catalog.byId.get(id);
    const name = entry?.name ?? `#${id}`;
    const desc = entry?.desc ?? "";
    if (q && !name.toLowerCase().includes(q) && !desc.toLowerCase().includes(q)) continue;
    const own = byPerm.get(id)!;
    const { value, decisive } = resolvePermission(own);
    const perm = {
      id,
      name,
      desc,
      value,
      sources: own.map((s, i) => ({ ...s, decisive: i === decisive })),
    };
    const cat = entry ? categoryOf(id, ends) : ends.length;
    buckets.set(cat, [...(buckets.get(cat) ?? []), perm]);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((cat) => ({
      label:
        cat < ends.length
          ? categoryLabel(
              catalog.entries.filter((e) => categoryOf(e.id, ends) === cat).map((e) => e.name),
            )
          : "",
      perms: buckets.get(cat)!,
    }));
}
