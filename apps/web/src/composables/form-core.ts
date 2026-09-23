/**
 * Framework-free half of `useForm`: running validation rules and turning
 * whatever a submit handler returned (or threw) into errors to display.
 * Kept free of Vue and i18n imports so it can be unit-tested on plain node.
 */

/**
 * One check on one field. Returns the message to show, or a falsy value when
 * the field passes. `values` is the whole form, for cross-field rules
 * ("repeat password").
 */
export type Rule<V, K extends keyof V = keyof V> = (
  value: V[K],
  values: Readonly<V>,
) => string | null | undefined | false;

/** Rules per field; the first one that fails wins, as in a native form. */
export type Rules<V> = { readonly [K in keyof V]?: Rule<V, K> | readonly Rule<V, K>[] };

export type FieldErrors<V> = { [K in keyof V]?: string };

/**
 * What a submit handler reports back when the server said no: a message for
 * the whole form, messages for particular fields, or both.
 */
export interface SubmitFailure<V> {
  readonly form?: string;
  readonly fields?: FieldErrors<V>;
}

/**
 * A submit handler may `return` its failure or `throw` it: throwing is
 * natural inside a chain of awaits, returning is natural for a handler that
 * only maps a status code. Both mean the same thing.
 */
export type SubmitResult<V> = void | undefined | null | string | SubmitFailure<V>;

/** An error that also carries per-field messages (e.g. "that name is taken"). */
export class FormError<V = Record<string, unknown>> extends Error {
  readonly fields: FieldErrors<V>;
  constructor(message: string, fields: FieldErrors<V> = {}) {
    super(message);
    this.name = "FormError";
    this.fields = fields;
  }
}

function rulesOf<V, K extends keyof V>(rules: Rules<V>, key: K): readonly Rule<V, K>[] {
  const r = rules[key] as Rule<V, K> | readonly Rule<V, K>[] | undefined;
  if (!r) return [];
  return typeof r === "function" ? [r] : r;
}

/** The first failing rule's message for one field, or `null` when it passes. */
export function checkField<V, K extends keyof V>(
  rules: Rules<V>,
  key: K,
  values: Readonly<V>,
): string | null {
  for (const rule of rulesOf(rules, key)) {
    const message = rule(values[key], values);
    if (message) return message;
  }
  return null;
}

/** Every failing field's message; an empty object means the form is valid. */
export function checkAll<V extends object>(rules: Rules<V>, values: Readonly<V>): FieldErrors<V> {
  const out: FieldErrors<V> = {};
  for (const key of Object.keys(rules) as (keyof V)[]) {
    const message = checkField(rules, key, values);
    if (message) out[key] = message;
  }
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Keeps only the string messages: the fields map comes from handler code we do not control. */
function cleanFields<V>(fields: unknown): FieldErrors<V> | undefined {
  if (!isRecord(fields)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string" && v) out[k] = v;
  }
  return Object.keys(out).length ? (out as FieldErrors<V>) : undefined;
}

/**
 * Normalises what a submit handler returned. `null` means success: anything
 * that is not a message or a failure object (`undefined`, `true`, a created
 * record) counts as "it worked".
 */
export function toSubmitFailure<V>(result: unknown): SubmitFailure<V> | null {
  if (typeof result === "string") return result ? { form: result } : null;
  if (!isRecord(result) || result instanceof Error) return null;
  if (!("form" in result) && !("fields" in result)) return null;
  const form = typeof result.form === "string" && result.form ? result.form : undefined;
  const fields = cleanFields<V>(result.fields);
  return form || fields ? { form, fields } : null;
}

/**
 * Normalises what a submit handler threw. Unlike a return value, a throw is
 * always a failure, so something unrecognisable still gets `fallback` rather
 * than being mistaken for success.
 */
export function thrownToFailure<V>(err: unknown, fallback: string): SubmitFailure<V> {
  if (err instanceof FormError) {
    return { form: err.message || undefined, fields: cleanFields<V>(err.fields) };
  }
  if (err instanceof Error) return { form: err.message || fallback };
  return toSubmitFailure<V>(err) ?? { form: fallback };
}

/**
 * A comparable fingerprint of a field value, for "did this field change" and
 * "is the form dirty". Form values are plain data (strings, numbers, arrays
 * of ids), so JSON is exact enough and catches in-place array edits too.
 */
export function fingerprint(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    // Circular or otherwise unserialisable: treat every read as a change.
    return `#${Math.random()}`;
  }
}

/* ------------------------------------------------------------------ rules */

/** A message, or a getter so a translated one follows a language switch. */
type Message = string | (() => string);
const say = (m: Message): string => (typeof m === "function" ? m() : m);

/**
 * A rule that only looks at its own value, so it fits any field of any form
 * (a parameter of type `unknown` accepts whatever the field holds).
 */
export type ValueRule = (value: unknown) => string | null;

/** Blank means empty, whitespace-only, an empty list, or no value at all. */
export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "number") return Number.isNaN(value);
  return false;
}

export function required(message: Message): ValueRule {
  return (v) => (isBlank(v) ? say(message) : null);
}

/** Length checks ignore an empty value; pair with `required` when it must be set. */
export function minLength(min: number, message: Message): ValueRule {
  return (v) => (typeof v === "string" && v !== "" && [...v].length < min ? say(message) : null);
}

export function maxLength(max: number, message: Message): ValueRule {
  return (v) => (typeof v === "string" && [...v].length > max ? say(message) : null);
}

export function pattern(re: RegExp, message: Message): ValueRule {
  return (v) => (typeof v === "string" && v !== "" && !re.test(v) ? say(message) : null);
}

/** Inclusive bounds; a non-number (an emptied `v-model.number` field) is left to `required`. */
export function between(min: number, max: number, message: Message): ValueRule {
  return (v) =>
    typeof v === "number" && !Number.isNaN(v) && (v < min || v > max) ? say(message) : null;
}
