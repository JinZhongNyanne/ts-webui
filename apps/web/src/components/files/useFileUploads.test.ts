import { beforeEach, describe, expect, it, vi } from "vitest";
import { ref, shallowRef } from "vue";
import type { Transfer } from "../../files/transfer-queue";
import { EMPTY_SELECTION } from "../../files/selection";
import type { BrowserContext } from "./useFileBrowser";

const confirmDialog = vi.fn(async () => true);
vi.mock("../ui/confirm", () => ({ confirmDialog: (...a: unknown[]) => confirmDialog(...a) }));

const store = {
  listFiles: vi.fn(async () => []),
  uploadFile: vi.fn(() => `ft${store.uploadFile.mock.calls.length}`),
  waitFor: vi.fn<(id: string) => Promise<Transfer>>(),
};
vi.mock("../../stores/transfers", () => ({ useTransfersStore: () => store }));

const { useFileUploads } = await import("./useFileUploads");

/** A browser File: a Blob with a name. */
const named = (name: string) => Object.assign(new Blob(["x"]), { name }) as unknown as File;

function failed(code: string, error = "whatever the text says"): Transfer {
  return {
    id: "ft1",
    kind: "upload",
    cid: "5",
    path: "/a.txt",
    name: "a.txt",
    size: 1,
    loaded: 0,
    origin: "browser",
    state: "failed",
    error,
    code,
  };
}

function browser() {
  const shown = { cid: ref<string | null>("5"), password: "pw5" };
  const ctx: BrowserContext = {
    cid: shown.cid,
    path: ref("/"),
    entries: shallowRef([]),
    cpw: () => shown.password,
    notice: ref(null),
    showTransfers: ref(false),
    scheduleReload: vi.fn(),
    load: vi.fn(async () => undefined),
    selection: shallowRef(EMPTY_SELECTION),
  };
  return { ctx, shown };
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmDialog.mockResolvedValue(true);
});

describe("file browser uploads", () => {
  it("retries a clash with the password of the channel it started in", async () => {
    let settle: (t: Transfer) => void = () => {};
    store.waitFor.mockReturnValueOnce(new Promise((r) => (settle = r)));
    store.waitFor.mockReturnValue(new Promise(() => {}));
    const { ctx, shown } = browser();
    const file = named("a.txt");
    await useFileUploads(ctx).uploadFiles([file]);
    expect(store.uploadFile).toHaveBeenCalledWith("5", "/", file, { cpw: "pw5", overwrite: false });

    // The user looks at another channel while it runs.
    shown.cid.value = "9";
    shown.password = "pw9";
    settle(failed("2050"));
    await vi.waitFor(() => expect(store.uploadFile).toHaveBeenCalledTimes(2));
    expect(store.uploadFile).toHaveBeenLastCalledWith("5", "/", file, {
      cpw: "pw5",
      overwrite: true,
    });
  });

  it("asks about a clash by its code, not by its text", async () => {
    store.waitFor.mockResolvedValueOnce(failed("781", "File exists"));
    const { ctx } = browser();
    await useFileUploads(ctx).uploadFiles([named("a.txt")]);
    await new Promise((r) => setTimeout(r, 0));
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(store.uploadFile).toHaveBeenCalledTimes(1);
  });

  it("lists the folder with the password it uploads with", async () => {
    store.waitFor.mockReturnValue(new Promise(() => {}));
    const { ctx } = browser();
    await useFileUploads(ctx).uploadFiles([named("a.txt")]);
    expect(store.listFiles).toHaveBeenCalledWith("5", "/", "pw5");
  });
});
