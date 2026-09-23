/**
 * The file browser window's state and actions (M3): the listing of the folder
 * the file browser store points at, the password prompt, the table's order
 * and selection, and upload / download / new folder / rename / delete.
 *
 * The server tells nobody about file changes (not even us), so every change
 * made here lists the folder again, and a finished upload does too. Answers
 * to an older listing (the user moved on meanwhile) are dropped.
 *
 * A typed channel password is only kept (in the ts store, where everything
 * else that needs one reads it) once a listing went through with it; one the
 * server refuses is dropped, so the next look asks again.
 */
import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";
import { joinFtPath, type FtEntry } from "@jinz/protocol";
import { useTsStore } from "../../stores/ts";
import { usePermsStore } from "../../stores/perms";
import { useTransfersStore } from "../../stores/transfers";
import { useFileBrowserStore } from "../../stores/fileBrowser";
import { TsCommandError } from "../../ts/commands";
import { DEFAULT_SORT, nextSort, sortEntries, type SortKey } from "../../files/browser";
import { fileActions } from "../../files/browser-perms";
import {
  clickSelect,
  EMPTY_SELECTION,
  pruneSelection,
  type ClickMods,
  type Selection,
} from "../../files/selection";
import { useFileUploads } from "./useFileUploads";
import { useFileEdits } from "./useFileEdits";

/** TeamSpeak's "wrong channel password". */
const TS_BAD_PASSWORD = "781";
/** A refresh after a burst of finished uploads waits this long for the rest. */
const RELOAD_DELAY_MS = 150;

export type BrowserStatus = "idle" | "loading" | "ready" | "error" | "password";

export function useFileBrowser() {
  const ts = useTsStore();
  const perms = usePermsStore();
  const transfers = useTransfersStore();
  const fb = useFileBrowserStore();

  const cid = computed(() => fb.channelId);
  const channel = computed(() => (cid.value ? (ts.channels.get(cid.value) ?? null) : null));
  const path = computed(() => fb.path);
  const place = computed(() => `${cid.value}:${path.value}`);

  const entries = shallowRef<FtEntry[]>([]);
  /** Which `place` `entries` belong to. */
  const listedAt = ref("");
  const status = ref<BrowserStatus>("idle");
  const error = ref<string | null>(null);
  /** The password prompt is up because the one we tried was refused. */
  const passwordWrong = ref(false);
  const sort = ref(DEFAULT_SORT);
  const selection = shallowRef(EMPTY_SELECTION);
  /** A message above the table: what an action did not manage. */
  const notice = ref<string | null>(null);
  const showTransfers = ref(false);

  const rows = computed(() => sortEntries(entries.value, sort.value));
  const actions = computed(() => fileActions(perms));
  const selected = computed(() => rows.value.filter((e) => selection.value.names.has(e.name)));
  const cpw = () => (cid.value ? ts.channelPasswordFor(cid.value) : "");
  /** A password typed into the prompt, tried by the next listing. */
  let typed: { cid: string; password: string } | null = null;

  let seq = 0;
  async function load(): Promise<void> {
    const c = cid.value;
    const at = place.value;
    const mine = ++seq;
    if (!c || ts.connState !== "connected") {
      entries.value = [];
      status.value = "idle";
      return;
    }
    // Moving elsewhere empties the table; a refresh keeps it until the answer.
    if (listedAt.value !== at) {
      entries.value = [];
      selection.value = EMPTY_SELECTION;
    }
    status.value = "loading";
    const guess = typed?.cid === c ? typed.password : null;
    const password = guess ?? cpw();
    try {
      const list = await transfers.listFiles(c, path.value, password);
      if (mine !== seq) return;
      // It worked, so it is the channel's password: everything else may use it.
      if (guess !== null) ts.rememberChannelPassword(c, guess);
      typed = null;
      entries.value = list;
      listedAt.value = at;
      selection.value = pruneSelection(
        selection.value,
        list.map((e) => e.name),
      );
      status.value = "ready";
      error.value = null;
    } catch (err) {
      if (mine !== seq) return;
      entries.value = [];
      listedAt.value = at;
      if (err instanceof TsCommandError && err.code === TS_BAD_PASSWORD) {
        // Wrong, whether typed just now or remembered from an earlier one.
        if (guess === null && password) ts.forgetChannelPassword(c);
        typed = null;
        passwordWrong.value = password !== "";
        status.value = "password";
        return;
      }
      error.value = err instanceof Error ? err.message : String(err);
      status.value = "error";
    }
  }

  let reloadTimer: ReturnType<typeof setTimeout> | null = null;
  /** Lists again soon; several calls in a row make one listing. */
  function scheduleReload(): void {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void load();
    }, RELOAD_DELAY_MS);
  }
  // The window may be closed between an upload and its refresh.
  onScopeDispose(() => reloadTimer !== null && clearTimeout(reloadTimer));

  watch(place, () => void load(), { immediate: true });
  // The channel shown was deleted: back to my own.
  watch(channel, (ch) => {
    if (!ch && cid.value && ts.connState === "connected") fb.setChannel(null);
  });
  watch(
    () => ts.connState,
    (state) => state === "connected" && void load(),
  );

  function submitPassword(password: string): void {
    if (!cid.value) return;
    typed = { cid: cid.value, password };
    void load();
  }

  function goTo(next: string): void {
    notice.value = null;
    fb.setPath(next);
  }

  function pickChannel(next: string): void {
    notice.value = null;
    fb.setChannel(next);
  }

  function select(name: string, mods: ClickMods): void {
    const order = rows.value.map((e) => e.name);
    selection.value = clickSelect(selection.value, order, name, mods);
  }

  function selectAll(on: boolean): void {
    selection.value = on
      ? { names: new Set(rows.value.map((e) => e.name)), anchor: null }
      : EMPTY_SELECTION;
  }

  function sortBy(key: SortKey): void {
    sort.value = nextSort(sort.value, key);
  }

  function download(files: readonly FtEntry[]): void {
    const c = cid.value;
    if (!c) return;
    for (const f of files) {
      const p = joinFtPath(path.value, f.name);
      if (!f.isDir && p) transfers.downloadFile(c, p, cpw());
    }
    if (files.some((f) => !f.isDir)) showTransfers.value = true;
  }

  /** A double-click (or "Open"): into a folder, or download a file. */
  function openEntry(entry: FtEntry): void {
    if (!entry.isDir) return download([entry]);
    const next = joinFtPath(path.value, entry.name);
    if (next) goTo(next);
  }

  const ctx = { cid, path, entries, cpw, notice, showTransfers, scheduleReload, load, selection };
  const uploads = useFileUploads(ctx);
  const edits = useFileEdits(ctx);

  return {
    cid,
    channel,
    path,
    rows,
    status,
    error,
    passwordWrong,
    sort,
    selection,
    selected,
    notice,
    showTransfers,
    actions,
    load,
    submitPassword,
    goTo,
    pickChannel,
    select,
    selectAll,
    sortBy,
    download,
    openEntry,
    ...uploads,
    ...edits,
  };
}

/** What the upload and edit halves share with the browser. */
export interface BrowserContext {
  readonly cid: Readonly<Ref<string | null>>;
  readonly path: Readonly<Ref<string>>;
  readonly entries: Readonly<Ref<readonly FtEntry[]>>;
  cpw(): string;
  readonly notice: Ref<string | null>;
  readonly showTransfers: Ref<boolean>;
  scheduleReload(): void;
  load(): Promise<void>;
  readonly selection: Ref<Selection>;
}
