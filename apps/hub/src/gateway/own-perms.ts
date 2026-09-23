/**
 * This client's own permissions, sent to the browser by name (`perms`), so the
 * UI can hide what the server would refuse anyway.
 *
 * Two sources, because neither is enough on its own:
 *  - `notifyclientneededpermissions`: pushed by the server after connecting
 *    (the whole set) and whenever our groups change (what moved). It only
 *    covers what the stock client needs to grey out its own menus: flags such
 *    as b_client_ban_create and a few limits. The powers compared against
 *    other clients (kick, move, ban...) are never in it.
 *  - `permget`: asked for the POWER_PERMS below, which the server allows with
 *    b_client_permissionoverview_own. Without that flag powers stay unknown
 *    (absent), which the browser reads as 0.
 */
import type { PermsMessage, TsCmdRow } from "@jinz/protocol";
import type { PermCatalog } from "./perms.js";

/**
 * Powers the UI gates on and the notify does not carry. Names a server's
 * catalog lacks are skipped, since one unknown name fails the whole command.
 */
export const POWER_PERMS: readonly string[] = [
  "i_client_kick_from_server_power",
  "i_client_kick_from_channel_power",
  "i_client_ban_power",
  "i_client_ban_max_bantime",
  "i_client_move_power",
  "i_client_complain_power",
  "i_client_poke_power",
  "i_client_private_textmessage_power",
  "i_client_whisper_power",
  "i_client_talk_power",
  "i_client_permission_modify_power",
  "i_channel_modify_power",
  "i_channel_delete_power",
  "i_channel_permission_modify_power",
  "i_channel_join_power",
  "i_channel_subscribe_power",
  "i_group_modify_power",
  "i_group_member_add_power",
  "i_group_member_remove_power",
  "i_permission_modify_power",
  "i_ft_file_upload_power",
  "i_ft_file_download_power",
  "i_ft_file_delete_power",
  "i_ft_file_rename_power",
  "i_ft_directory_create_power",
  "i_ft_file_browse_power",
  // M3: the upload limit (files/limits.ts) takes the quota into account.
  "i_ft_quota_mb_upload_per_client",
  "i_ft_quota_mb_download_per_client",
  // M2 admin tool flags the notify leaves out (checked against a live TS3
  // server: it carries b_client_complain_list, b_virtualserver_client_dblist,
  // b_virtualserver_modify_temporary_passwords and b_client_offline_textmessage_send,
  // but not these).
  "b_client_complain_delete",
  "b_client_complain_delete_own",
  "b_virtualserver_client_dbsearch",
  "b_virtualserver_client_dbinfo",
  "b_client_modify_dbproperties",
  "b_client_delete_dbproperties",
  "b_virtualserver_modify_temporary_passwords_own",
];

/** What `permget` needs; without it the server answers 2568. */
export const PERM_OVERVIEW_OWN = "b_client_permissionoverview_own";

export interface OwnPermissionsDeps {
  /** Resolves the catalog (cached or fetched); throws when the server refuses. */
  catalog: () => Promise<PermCatalog>;
  /** Runs `permget` for these names and returns its rows (`permsid`, `permvalue`). */
  permget?: (names: readonly string[]) => Promise<TsCmdRow[]>;
  emit: (msg: PermsMessage) => void;
  onError: (err: unknown) => void;
}

/** Rows of one notify arrive one by one from the raw tap; this is how long we gather them. */
const COALESCE_MS = 50;

/**
 * Nothing is sent before `start()`: the first batch arrives during the
 * welcome sequence, before the browser has its snapshot, and resolving names
 * costs a command we do not want in the middle of the handshake. Every later
 * batch means our groups changed, so the powers are asked for again with it.
 * A group change can also come with no batch at all — one that grants only a
 * power changes none of the flags the notify carries — so the session says
 * so itself (`refreshPowers`) when the server tells it we joined or left a
 * server group, or got another channel group.
 */
export class OwnPermissions {
  private readonly values = new Map<number, number>();
  private pending = new Map<number, number>();
  /** Last power values sent, so a patch only carries the ones that moved. */
  private powers = new Map<string, number>();
  private started = false;
  private sentFull = false;
  /** Our groups changed since the powers were last read. */
  private powersStale = false;
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;

  constructor(private readonly deps: OwnPermissionsDeps) {}

  /** One `notifyclientneededpermissions` row. */
  add(permId: number, value: number): void {
    if (!Number.isInteger(permId) || permId <= 0 || !Number.isFinite(value)) return;
    this.values.set(permId, value);
    this.pending.set(permId, value);
    this.schedule();
  }

  /** Our groups changed: read the powers again, even if no batch comes with it. */
  refreshPowers(): void {
    if (!this.started) return;
    this.powersStale = true;
    this.schedule();
  }

  start(): void {
    this.started = true;
    this.schedule();
  }

  /**
   * A permission's value by name, when the server told us: a power from
   * `permget`, else a value from the notify (named through `catalog`).
   */
  lookup(name: string, catalog: PermCatalog | undefined): number | undefined {
    const power = this.powers.get(name);
    if (power !== undefined) return power;
    if (!catalog) return undefined;
    for (const [id, value] of this.values) if (catalog.byId.get(id) === name) return value;
    return undefined;
  }

  /** Forgets everything (a new connect attempt, or the session ending). */
  reset(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.values.clear();
    this.pending = new Map();
    this.powers = new Map();
    this.started = false;
    this.sentFull = false;
    this.powersStale = false;
  }

  private schedule(): void {
    if (!this.started || this.timer || this.flushing) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushing = this.flush().finally(() => {
        this.flushing = null;
        // Rows that arrived while the catalog was loading go out in the next
        // round. After a failure only fresh rows try again, so a server that
        // refuses `permissionlist` is not asked on a loop.
        if (this.sentFull && (this.pending.size > 0 || this.powersStale)) this.schedule();
      });
    }, COALESCE_MS);
  }

  /** Sends what is pending; exposed for tests (the timer calls it otherwise). */
  async flush(): Promise<void> {
    if (!this.started) return;
    if (this.sentFull && this.pending.size === 0 && !this.powersStale) return;
    // Read below whatever happens: a refusal is not retried on a loop.
    this.powersStale = false;
    let catalog: PermCatalog;
    try {
      catalog = await this.deps.catalog();
    } catch (err) {
      this.deps.onError(err);
      return;
    }
    const full = !this.sentFull;
    const needed = named(full ? this.values : this.pending, catalog);
    this.pending = new Map();
    const powers = await this.fetchPowers(catalog, named(this.values, catalog));
    if (!this.started) return;
    const moved: Record<string, number> = {};
    for (const [name, value] of powers) {
      if (full || this.powers.get(name) !== value) moved[name] = value;
    }
    this.powers = powers;
    this.sentFull = true;
    const values = { ...moved, ...needed };
    if (!full && Object.keys(values).length === 0) return;
    this.deps.emit({ type: "perms", full, values });
  }

  private async fetchPowers(
    catalog: PermCatalog,
    known: Record<string, number>,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!this.deps.permget || (known[PERM_OVERVIEW_OWN] ?? 0) < 1) return out;
    const names = new Set(catalog.byId.values());
    const wanted = POWER_PERMS.filter((n) => names.has(n));
    if (wanted.length === 0) return out;
    try {
      for (const row of await this.deps.permget(wanted)) {
        const name = row["permsid"];
        const value = Number(row["permvalue"]);
        if (name && Number.isFinite(value)) out.set(name, value);
      }
    } catch (err) {
      // The flags from the notify are still worth sending without the powers.
      this.deps.onError(err);
    }
    return out;
  }
}

function named(ids: ReadonlyMap<number, number>, catalog: PermCatalog): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, value] of ids) {
    const name = catalog.byId.get(id);
    if (name) out[name] = value;
  }
  return out;
}
