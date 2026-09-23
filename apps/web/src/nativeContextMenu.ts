/**
 * Whether an element right-clicked in the app shell should keep the browser's
 * own context menu.
 *
 * The app looks like a desktop OS, so a bare right click anywhere is meant to
 * open one of *its* menus (or nothing) rather than the browser's — except
 * where the browser's menu is the feature people expect: copy/paste,
 * spellcheck and autocorrect inside actual text entry. That is `<textarea>`,
 * a text-ish `<input>`, and anything `contenteditable`. A checkbox, radio,
 * range or plain button never had free text to act on, so it is not exempt.
 */

/**
 * `<input>` types where the browser's copy/paste/spellcheck menu is useful.
 * Everything else (`checkbox`, `radio`, `range`, `button`, `submit`, `file`,
 * `color`, the date/time pickers, …) has no free text for that menu to act on.
 */
const TEXT_ENTRY_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "password",
  "number",
  "tel",
]);

/** The bare facts `keepsNativeContextMenu` needs, read off a real `Element` at the call site. */
export interface ContextMenuTargetInfo {
  /** `Element.tagName`, any case. */
  readonly tagName: string;
  /** An `<input>`'s `.type` (already normalised to `"text"` by the DOM when unset). Ignored for other tags. */
  readonly inputType?: string;
  /** `HTMLElement.isContentEditable`, which already accounts for an ancestor's `contenteditable`. */
  readonly isContentEditable: boolean;
}

/** True when the target is genuine text entry and should keep the native menu. */
export function keepsNativeContextMenu(target: ContextMenuTargetInfo): boolean {
  const tag = target.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input")
    return TEXT_ENTRY_INPUT_TYPES.has((target.inputType ?? "text").toLowerCase());
  return target.isContentEditable;
}
