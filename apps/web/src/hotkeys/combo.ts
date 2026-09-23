/**
 * Hotkey combos: parsing, display, matching against DOM events, and conflict
 * detection. Pure — the runtime listeners live in `useHotkeys.ts`.
 *
 * A combo is stored as a string: modifiers in a fixed order, then the key, all
 * joined with "+", e.g. "Ctrl+Shift+KeyM", "KeyV", "ControlLeft" or "Mouse4".
 * Keys are `KeyboardEvent.code` values (the physical key, so a binding survives
 * a keyboard-layout switch); mouse buttons are "Mouse3" (middle), "Mouse4"
 * (back) and "Mouse5" (forward). A modifier key can be a binding by itself —
 * plenty of people push-to-talk on a bare Ctrl or Alt — and then it carries no
 * modifier flags of its own.
 */

export const MODIFIERS = ["Ctrl", "Alt", "Shift", "Meta"] as const;
export type Modifier = (typeof MODIFIERS)[number];

export interface Combo {
  mods: ReadonlySet<Modifier>;
  key: string;
}

export interface ModifierState {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

export interface KeyLike extends ModifierState {
  code: string;
}

export interface MouseLike extends ModifierState {
  button: number;
}

/** `KeyboardEvent.code`s of the modifier keys themselves. */
const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
  "OSLeft",
  "OSRight",
]);

/** DOM `MouseEvent.button` -> key name. Left and right click are never bindable. */
const MOUSE_KEYS: Record<number, string> = { 1: "Mouse3", 3: "Mouse4", 4: "Mouse5" };

export function isModifierCode(code: string): boolean {
  return MODIFIER_CODES.has(code);
}

export function isMouseKey(key: string): boolean {
  return /^Mouse[345]$/.test(key);
}

function heldModifiers(ev: ModifierState): Set<Modifier> {
  const mods = new Set<Modifier>();
  if (ev.ctrlKey) mods.add("Ctrl");
  if (ev.altKey) mods.add("Alt");
  if (ev.shiftKey) mods.add("Shift");
  if (ev.metaKey) mods.add("Meta");
  return mods;
}

export function formatCombo(c: Combo): string {
  return [...MODIFIERS.filter((m) => c.mods.has(m)), c.key].join("+");
}

/** Parses a stored combo; null for "" (unbound) or anything malformed. */
export function parseCombo(text: string): Combo | null {
  if (!text) return null;
  const parts = text.split("+");
  const key = parts.pop() ?? "";
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key)) return null;
  const mods = new Set<Modifier>();
  for (const p of parts) {
    if (!(MODIFIERS as readonly string[]).includes(p) || mods.has(p as Modifier)) return null;
    mods.add(p as Modifier);
  }
  // A lone modifier key is its own binding; flags on top of it mean nothing.
  if (isModifierCode(key) && mods.size > 0) return null;
  return { mods, key };
}

export function comboFromKey(ev: KeyLike): Combo {
  if (isModifierCode(ev.code)) return { mods: new Set(), key: ev.code };
  return { mods: heldModifiers(ev), key: ev.code };
}

export function comboFromMouse(ev: MouseLike): Combo | null {
  const key = MOUSE_KEYS[ev.button];
  return key ? { mods: heldModifiers(ev), key } : null;
}

/** The key name an event carries, in combo terms ("KeyV", "Mouse4"), or null. */
export function eventKey(ev: KeyLike | MouseLike): string | null {
  if ("code" in ev) return ev.code;
  return MOUSE_KEYS[ev.button] ?? null;
}

/**
 * Whether a press matches a combo. Exact by default: Ctrl+M must not also fire
 * a plain M binding. `loose` lets extra modifiers through, which push-to-talk
 * needs — holding Shift for a capital letter in a game must not cut you off.
 */
export function matchesPress(combo: Combo, ev: KeyLike | MouseLike, loose = false): boolean {
  if (eventKey(ev) !== combo.key) return false;
  if (isModifierCode(combo.key)) return true;
  const held = heldModifiers(ev);
  for (const m of combo.mods) if (!held.has(m)) return false;
  if (loose) return true;
  return held.size === combo.mods.size;
}

/** Releasing the main key ends a hold, whatever happened to the modifiers meanwhile. */
export function matchesRelease(combo: Combo, ev: KeyLike | MouseLike): boolean {
  return eventKey(ev) === combo.key;
}

/* ------------------------------- display -------------------------------- */

const KEY_NAMES: Record<string, string> = {
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt",
  AltRight: "Right Alt",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  MetaLeft: "Left Meta",
  MetaRight: "Right Meta",
  OSLeft: "Left Meta",
  OSRight: "Right Meta",
  Mouse3: "Mouse 3",
  Mouse4: "Mouse 4",
  Mouse5: "Mouse 5",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
  Space: "Space",
  CapsLock: "Caps Lock",
};

export function keyLabel(key: string): string {
  if (KEY_NAMES[key]) return KEY_NAMES[key];
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Digit\d$/.test(key)) return key.slice(5);
  if (/^Numpad/.test(key)) return `Num ${key.slice(6)}`;
  if (/^Arrow/.test(key)) return key.slice(5);
  return key;
}

/** Human-readable combo, e.g. "Ctrl + Shift + M". */
export function comboLabel(c: Combo): string {
  return [...MODIFIERS.filter((m) => c.mods.has(m)), keyLabel(c.key)].join(" + ");
}

/* ------------------------------ conflicts ------------------------------- */

export interface BindingSpec<A extends string> {
  action: A;
  combo: string;
  /** Matched with `loose` (see matchesPress). */
  loose?: boolean;
}

export interface Conflict<A extends string> {
  a: A;
  b: A;
}

function subset(small: ReadonlySet<Modifier>, big: ReadonlySet<Modifier>): boolean {
  for (const m of small) if (!big.has(m)) return false;
  return true;
}

/** Could one physical press set off both bindings? */
function overlaps(x: Combo, xLoose: boolean, y: Combo, yLoose: boolean): boolean {
  if (x.key !== y.key) return false;
  if (isModifierCode(x.key)) return true;
  if (x.mods.size === y.mods.size && subset(x.mods, y.mods)) return true;
  // A loose binding also fires for any superset of its modifiers.
  return (xLoose && subset(x.mods, y.mods)) || (yLoose && subset(y.mods, x.mods));
}

/** Pairs of actions one press would trigger together. Unbound actions never conflict. */
export function findConflicts<A extends string>(specs: readonly BindingSpec<A>[]): Conflict<A>[] {
  const parsed = specs
    .map((s) => ({ ...s, parsed: parseCombo(s.combo) }))
    .filter((s): s is typeof s & { parsed: Combo } => s.parsed !== null);
  const out: Conflict<A>[] = [];
  parsed.forEach((x, i) => {
    for (const y of parsed.slice(i + 1)) {
      if (overlaps(x.parsed, !!x.loose, y.parsed, !!y.loose)) {
        out.push({ a: x.action, b: y.action });
      }
    }
  });
  return out;
}

/* ------------------------------ focus guard ----------------------------- */

/** Input types that take no text, so a hotkey pressed on them is not "typing". */
const NON_TEXT_INPUTS = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

export interface ElementLike {
  tagName: string;
  isContentEditable?: boolean;
  type?: string;
}

/** Is keyboard focus somewhere the user is typing text? */
export function isTypingTarget(el: ElementLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((el.type ?? "text").toLowerCase());
  return false;
}
