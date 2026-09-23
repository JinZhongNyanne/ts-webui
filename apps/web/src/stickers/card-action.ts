/**
 * "Add to stickers" on a picture shown in chat (chat/files/card-menu.ts).
 *
 * A picture in the chat log is already a file on the server, and the page is
 * showing its bytes; keeping it is one upload to the hub, where the hash
 * decides whether anything is stored at all (a sticker someone else already
 * added costs nothing but an entry). Both scopes get an entry of their own
 * rather than a submenu, since the menu has no submenus.
 */
import { t } from "../i18n";
import { registerCardAction, type CardMenuTarget } from "../chat/files/card-menu";
import { useStickersStore } from "../stores/stickers";
import { stickerErrorText } from "./errors";
import { stickerNameFromFile, type StickerScope } from "@jinz/protocol";

/** The shown picture's bytes, as a File the sticker store can upload. */
export async function pictureOf(target: CardMenuTarget): Promise<File | null> {
  if (!target.url) return null;
  try {
    const res = await fetch(target.url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new File([blob], target.name, { type: blob.type || "image/png" });
  } catch {
    return null;
  }
}

/** Adds the shown picture to `scope`, ungrouped; returns why not when it fails. */
export async function addPictureToStickers(
  target: CardMenuTarget,
  scope: StickerScope,
): Promise<string | null> {
  const file = await pictureOf(target);
  if (!file) return stickerErrorText("failed");
  const stickers = useStickersStore();
  const problem = await stickers.upload(scope, file, stickerNameFromFile(target.name), null);
  return problem ? stickerErrorText(problem) : null;
}

function register(scope: StickerScope, id: string, icon: string, label: () => string): void {
  registerCardAction({
    id,
    icon,
    label,
    // Only a picture that is actually on screen: its bytes are already here.
    enabled: (target) => target.url !== undefined,
    run: (target) => {
      void addPictureToStickers(target, scope).then((problem) => {
        const status = target.card.querySelector<HTMLElement>(".bb-file-status");
        if (!status) return;
        status.textContent = problem ?? t("stickers.added");
        status.dataset.kind = problem ? "error" : "";
      });
    },
  });
}

register("personal", "stickers.addPersonal", "⭐", () => t("stickers.addPersonal"));
register("shared", "stickers.addShared", "🌟", () => t("stickers.addShared"));
