/**
 * New folder, rename and delete in the file browser. Names are checked
 * against the listing before anything is sent: the server would replace a
 * file on a rename onto its name. Whatever the outcome, the folder is listed
 * again (a delete of several paths can stop half-way).
 */
import { ref, shallowRef } from "vue";
import type { FtEntry } from "@jinz/protocol";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog } from "../ui/confirm";
import { folderNameProblem, renameProblem, type NameProblem } from "../../files/browser";
import { createFolder, deleteEntries, renameEntry } from "../../files/manage";
import type { BrowserContext } from "./useFileBrowser";

/** The name dialog: a new folder, or a new name for `entry`. */
export type NameDialog = { kind: "folder" } | { kind: "rename"; entry: FtEntry };

const PROBLEM_KEYS: Record<Exclude<NameProblem, "unchanged">, MessageKey> = {
  invalid: "fb.nameInvalid",
  exists: "fb.nameExists",
};

/** How many names a delete prompt spells out before "…". */
const NAMES_SHOWN = 8;

export function useFileEdits(ctx: BrowserContext) {
  const { t } = useI18n();
  const nameDialog = shallowRef<NameDialog | null>(null);
  const nameError = ref<string | null>(null);
  const busy = ref(false);

  function openNameDialog(dialog: NameDialog): void {
    nameError.value = null;
    nameDialog.value = dialog;
  }

  function closeNameDialog(): void {
    if (!busy.value) nameDialog.value = null;
  }

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  async function submitName(raw: string): Promise<void> {
    const dialog = nameDialog.value;
    const cid = ctx.cid.value;
    if (!dialog || !cid || busy.value) return;
    const name = raw.trim();
    const problem =
      dialog.kind === "folder"
        ? folderNameProblem(ctx.entries.value, name)
        : renameProblem(ctx.entries.value, dialog.entry.name, name);
    if (problem === "unchanged") return closeNameDialog();
    if (problem) {
      nameError.value = t(PROBLEM_KEYS[problem]);
      return;
    }
    busy.value = true;
    try {
      if (dialog.kind === "folder") await createFolder(cid, ctx.path.value, name, ctx.cpw());
      else await renameEntry(cid, ctx.path.value, dialog.entry.name, name, ctx.cpw());
      busy.value = false;
      nameDialog.value = null;
      ctx.selection.value = { names: new Set([name]), anchor: name };
      await ctx.load();
    } catch (err) {
      nameError.value = message(err);
    } finally {
      busy.value = false;
    }
  }

  async function deleteEntriesAsked(targets: readonly FtEntry[]): Promise<void> {
    const cid = ctx.cid.value;
    if (!cid || !targets.length) return;
    const names = targets.map((e) => e.name);
    const shown = names.slice(0, NAMES_SHOWN).join(", ");
    const ok = await confirmDialog({
      title:
        names.length === 1
          ? t("fb.deleteOne", { name: names[0]! })
          : t("fb.deleteTitle", { n: names.length }),
      message: t("fb.deleteMsg", {
        names: names.length > NAMES_SHOWN ? `${shown}, …` : shown,
      }),
      confirmLabel: t("fb.deleteConfirm"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteEntries(cid, ctx.path.value, names, ctx.cpw());
      ctx.notice.value = null;
    } catch (err) {
      ctx.notice.value = t("fb.actionFailed", { msg: message(err) });
    } finally {
      await ctx.load();
    }
  }

  return {
    nameDialog,
    nameError,
    busy,
    openNameDialog,
    closeNameDialog,
    submitName,
    deleteEntries: deleteEntriesAsked,
  };
}
