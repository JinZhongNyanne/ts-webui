/**
 * Uploads from the file browser: picked or dropped files go into the folder
 * shown. Names already there are checked against a fresh listing first and
 * replaced only after asking; a clash the listing could not show (someone was
 * quicker) comes back from the server as "file exists" (2050), and is asked
 * about then. The folder is listed again as each upload finishes.
 *
 * Where an upload goes — channel, folder and password — is settled when it
 * starts: the user may well be looking somewhere else by the time it ends
 * and its overwrite goes out.
 */
import type { FtEntry } from "@jinz/protocol";
import { useTransfersStore } from "../../stores/transfers";
import { useI18n, type MessageKey } from "../../i18n";
import { confirmDialog } from "../ui/confirm";
import { planUploads, type UploadConflict } from "../../files/browser";
import type { Transfer } from "../../files/transfer-queue";
import type { BrowserContext } from "./useFileBrowser";

const SKIP_KEYS: Record<Exclude<UploadConflict, "file" | null>, MessageKey> = {
  folder: "fb.skippedFolder",
  invalid: "fb.skippedInvalid",
  duplicate: "fb.skippedDuplicate",
};

/** TeamSpeak's "file already exists". */
const TS_FILE_EXISTS = "2050";

/** Where an upload goes, as it was when the user started it. */
interface Target {
  readonly cid: string;
  readonly dir: string;
  readonly cpw: string;
}

export function useFileUploads(ctx: BrowserContext) {
  const transfers = useTransfersStore();
  const { t } = useI18n();

  /** The folder as the server has it now; the table's copy if that fails. */
  async function freshListing(to: Target): Promise<readonly FtEntry[]> {
    try {
      return await transfers.listFiles(to.cid, to.dir, to.cpw);
    } catch {
      return ctx.entries.value;
    }
  }

  function askOverwrite(names: readonly string[]): Promise<boolean> {
    return confirmDialog({
      title: t("fb.overwriteTitle"),
      message: t("fb.overwriteMsg", { names: names.join(", ") }),
      confirmLabel: t("fb.overwrite"),
      cancelLabel: t("fb.skip"),
      danger: true,
    });
  }

  /** Uploads `files` into the folder shown. */
  async function uploadFiles(files: readonly File[]): Promise<void> {
    const cid = ctx.cid.value;
    if (!cid || !files.length) return;
    const to: Target = { cid, dir: ctx.path.value, cpw: ctx.cpw() };
    const plans = planUploads(await freshListing(to), files);
    const clashes = plans.filter((p) => p.conflict === "file");
    const overwrite = clashes.length > 0 && (await askOverwrite(clashes.map((p) => p.name)));
    const skipped = plans.flatMap((p) =>
      p.conflict && p.conflict !== "file" ? [t(SKIP_KEYS[p.conflict], { name: p.name })] : [],
    );
    ctx.notice.value = skipped.length ? skipped.join(" ") : null;
    for (const p of plans) {
      if (p.conflict === null) start(to, files[p.index]!, false);
      else if (p.conflict === "file" && overwrite) start(to, files[p.index]!, true);
    }
  }

  function start(to: Target, file: File, overwrite: boolean): void {
    const id = transfers.uploadFile(to.cid, to.dir, file, { cpw: to.cpw, overwrite });
    ctx.showTransfers.value = true;
    void transfers.waitFor(id).then((done) => finished(done, to, file, overwrite));
  }

  async function finished(
    done: Transfer,
    to: Target,
    file: File,
    overwrite: boolean,
  ): Promise<void> {
    const here = ctx.cid.value === to.cid && ctx.path.value === to.dir;
    if (here) ctx.scheduleReload();
    // Created by someone else since our listing: the server's 2050.
    if (done.state === "failed" && !overwrite && done.code === TS_FILE_EXISTS) {
      if (await askOverwrite([done.name])) start(to, file, true);
    }
  }

  return { uploadFiles };
}
