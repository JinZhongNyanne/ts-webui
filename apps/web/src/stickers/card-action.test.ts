import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { cardActions } from "../chat/files/card-menu";
import type { CardMenuTarget } from "../chat/files/card-menu";
// Registering happens at import time, as it does in the app (via richClick).
import { addPictureToStickers } from "./card-action";

const upload = vi.fn(async () => null as string | null);
vi.mock("../stores/stickers", () => ({ useStickersStore: () => ({ upload }) }));

const target = (url: string | undefined): CardMenuTarget => ({
  // Only `run()` touches the card, and these tests call the action directly.
  card: {} as unknown as HTMLElement,
  file: { cid: "5", path: "/imgs/cat.png" },
  name: "cat.png",
  url,
});

beforeEach(() => {
  setActivePinia(createPinia());
  upload.mockClear();
});

describe("add to stickers", () => {
  it("offers both scopes, but only for a picture that is shown", () => {
    const ids = cardActions().map((a) => a.id);
    expect(ids).toEqual(expect.arrayContaining(["stickers.addPersonal", "stickers.addShared"]));
    for (const action of cardActions().filter((a) => a.id.startsWith("stickers."))) {
      expect(action.enabled?.(target("blob:x"))).toBe(true);
      expect(action.enabled?.(target(undefined))).toBe(false);
    }
  });

  it("uploads the shown bytes under the file's name, ungrouped", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(blob, { headers: { "content-type": "image/png" } })),
    );
    expect(await addPictureToStickers(target("blob:x"), "personal")).toBeNull();
    expect(upload).toHaveBeenCalledTimes(1);
    const [scope, file, name, pack] = upload.mock.calls[0]!;
    expect([scope, name, pack]).toEqual(["personal", "cat", null]);
    expect((file as File).name).toBe("cat.png");
    vi.unstubAllGlobals();
  });

  it("says so when the picture is gone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );
    expect(await addPictureToStickers(target("blob:x"), "shared")).not.toBeNull();
    expect(upload).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
