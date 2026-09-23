/**
 * What the menu of a picture shown in chat offers — the right button on the
 * desktop, a held finger on a phone (chat/richClick.ts opens it, the store in
 * stores/contextMenu.ts renders it).
 *
 * A shown picture is only its picture: no name, no size, no buttons (see
 * sticker.ts), so everything the card used to do with a button lives here
 * instead.
 *
 * ## Adding an entry
 *
 * The entries are a registry, not a list, so a feature in its own module can
 * add one without this file knowing it exists (and without that module having
 * to be imported from here). Register once, at import time:
 *
 *     import { registerCardAction } from "../chat/files/card-menu";
 *
 *     registerCardAction({
 *       id: "stickers.add",
 *       label: () => t("stickers.add"),
 *       icon: "⭐",
 *       // Left out of the menu when this says no.
 *       enabled: (target) => target.url !== undefined,
 *       run: (target) => addToStickers(target.name, target.url!),
 *     });
 *
 * An id registers once, so a module reloaded in development does not double
 * its entry. The order entries are registered in is the order they appear.
 * `card-actions.ts` registers Download and "open in a new tab" the same way:
 * nothing here is a special case.
 */
import type { MenuItem } from "../../stores/contextMenu";
import type { CardFile } from "./card";

/** The picture an entry acts on. */
export interface CardMenuTarget {
  /** The card in the chat log (`.bb-file`), for anything that must change it. */
  readonly card: HTMLElement;
  /** Which file it is on the server. */
  readonly file: CardFile;
  /** Its name, as the link gave it. */
  readonly name: string;
  /** The picture's `blob:` URL while it is shown; undefined when it is not. */
  readonly url: string | undefined;
}

export interface CardMenuAction {
  /** Unique; registering the same one twice keeps the first. */
  readonly id: string;
  label(target: CardMenuTarget): string;
  readonly icon?: string;
  /** Whether it applies to this picture at all; missing means always. */
  enabled?(target: CardMenuTarget): boolean;
  run(target: CardMenuTarget): void;
}

let actions: readonly CardMenuAction[] = [];

export function registerCardAction(action: CardMenuAction): void {
  if (actions.some((a) => a.id === action.id)) return;
  actions = [...actions, action];
}

/** Everything registered, in registration order. */
export function cardActions(): readonly CardMenuAction[] {
  return Object.freeze([...actions]);
}

/** Forgets every entry; for tests. */
export function resetCardActions(): void {
  actions = [];
}

/** The menu for `target`: the entries that apply, already bound to it. */
export function cardMenuItems(target: CardMenuTarget): MenuItem[] {
  return actions
    .filter((a) => a.enabled?.(target) ?? true)
    .map((a) => ({
      label: a.label(target),
      ...(a.icon === undefined ? {} : { icon: a.icon }),
      // The id doubles as the handle tests click by, the labels being translated.
      testId: a.id,
      action: () => a.run(target),
    }));
}
