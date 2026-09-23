/**
 * Form state for the admin dialogs: values, sync validation, submit state and
 * server errors, in one object the template binds to.
 *
 *   const form = useForm({
 *     initial: { name: "", reason: "" },
 *     rules: { name: [rules.required(), rules.maxLength(40)] },
 *     onSubmit: async (v) => {
 *       const res = await ts.command(...);
 *       if (!res.ok) return res.message;            // shown above the actions
 *       // or: return { fields: { name: "taken" } } / throw new FormError(...)
 *     },
 *   });
 *
 * Errors appear per field once it was left (`touch`, wire it to `@blur`) or a
 * submit was attempted, and then follow the user's typing live — so nobody is
 * scolded for a field they have not reached yet, and a fixed field clears at
 * once. A server error on a field clears as soon as that field is edited.
 */
import { computed, reactive, ref, toRaw, watch, type ComputedRef, type Ref } from "vue";
import { t } from "../i18n";
import {
  between,
  checkAll,
  checkField,
  fingerprint,
  maxLength,
  minLength,
  pattern,
  required,
  thrownToFailure,
  toSubmitFailure,
  type FieldErrors,
  type Rules,
  type SubmitFailure,
  type SubmitResult,
} from "./form-core";

export { FormError, type Rule, type Rules, type SubmitResult } from "./form-core";

export interface UseFormOptions<V extends object> {
  /** Starting values; a function is called again on every `reset()`. */
  readonly initial: V | (() => V);
  readonly rules?: Rules<V>;
  /**
   * Runs only when every rule passes. Return (or throw) a message or a
   * `{ form, fields }` object to report a failure; anything else is success.
   * Receives a copy, so later edits to the form cannot change what was sent.
   */
  readonly onSubmit: (values: V) => SubmitResult<V> | Promise<SubmitResult<V>>;
}

export interface Form<V extends object> {
  /** The live values; bind with `v-model="form.values.x"`. */
  readonly values: V;
  /** Messages currently shown, per field. */
  readonly errors: Readonly<FieldErrors<V>>;
  /** A message for the form as a whole (from the submit handler). */
  readonly formError: Readonly<Ref<string | null>>;
  readonly submitting: Readonly<Ref<boolean>>;
  /** True from the first submit attempt until `reset()`. */
  readonly submitted: Readonly<Ref<boolean>>;
  /** Some value differs from the initial one. */
  readonly dirty: ComputedRef<boolean>;
  /** Every rule passes right now, whether or not the errors are shown yet. */
  readonly valid: ComputedRef<boolean>;
  /** Marks a field as visited and shows its error; wire to `@blur`. */
  readonly touch: (key: keyof V) => void;
  /** Validates and shows every field; returns whether the form is valid. */
  readonly validate: () => boolean;
  /** Validates, then runs `onSubmit`. Resolves true when it succeeded. */
  readonly submit: () => Promise<boolean>;
  /** Back to the initial values (merged with `next`), with no errors shown. */
  readonly reset: (next?: Partial<V>) => void;
  /** Shows errors that came from elsewhere, e.g. a server push after submit. */
  readonly setErrors: (failure: SubmitFailure<V>) => void;
}

/** Shown when a handler throws something without a message of its own. */
const fallbackMessage = (): string => t("form.submitFailed");

export function useForm<V extends object>(options: UseFormOptions<V>): Form<V> {
  const rules: Rules<V> = options.rules ?? {};
  const makeInitial = (): V =>
    typeof options.initial === "function" ? (options.initial as () => V)() : options.initial;

  let initial = { ...makeInitial() };
  const values = reactive({ ...initial }) as V;
  const errors = reactive({}) as FieldErrors<V>;
  const formError = ref<string | null>(null);
  const submitting = ref(false);
  const submitted = ref(false);
  const touched = new Set<keyof V>();

  const keys = (): (keyof V)[] => Object.keys(values) as (keyof V)[];
  const prints = (v: V): Map<keyof V, string> => new Map(keys().map((k) => [k, fingerprint(v[k])]));
  let initialPrints = prints(initial);
  let lastPrints = prints(values);

  function show(key: keyof V): void {
    const message = checkField(rules, key, values);
    if (message) errors[key] = message;
    else delete errors[key];
  }

  function clearErrors(): void {
    for (const k of Object.keys(errors) as (keyof V)[]) delete errors[k];
  }

  // Sync, so the error under a field updates on the same keystroke (and a
  // test can assert right after assigning).
  watch(
    () => prints(values),
    (now) => {
      for (const [key, print] of now) {
        if (lastPrints.get(key) === print) continue;
        if (touched.has(key) || submitted.value) show(key);
        else delete errors[key]; // a server message on an unvisited field
      }
      lastPrints = now;
    },
    { flush: "sync" },
  );

  const dirty = computed(() => {
    const now = prints(values);
    return [...now].some(([k, p]) => initialPrints.get(k) !== p);
  });
  const valid = computed(() => Object.keys(checkAll(rules, values)).length === 0);

  function touch(key: keyof V): void {
    touched.add(key);
    show(key);
  }

  function validate(): boolean {
    const found = checkAll(rules, values);
    clearErrors();
    Object.assign(errors, found);
    return Object.keys(found).length === 0;
  }

  function setErrors(failure: SubmitFailure<V>): void {
    formError.value = failure.form ?? null;
    if (failure.fields) Object.assign(errors, failure.fields);
  }

  async function submit(): Promise<boolean> {
    if (submitting.value) return false;
    submitted.value = true;
    formError.value = null;
    if (!validate()) return false;
    submitting.value = true;
    let failure: SubmitFailure<V> | null;
    try {
      failure = toSubmitFailure<V>(await options.onSubmit({ ...toRaw(values) } as V));
    } catch (err) {
      failure = thrownToFailure<V>(err, fallbackMessage());
    } finally {
      submitting.value = false;
    }
    if (failure) setErrors(failure);
    return failure === null;
  }

  function reset(next?: Partial<V>): void {
    initial = { ...makeInitial(), ...next };
    touched.clear();
    submitted.value = false;
    formError.value = null;
    Object.assign(values, initial);
    initialPrints = prints(initial);
    lastPrints = prints(values);
    // After the assignment: the watcher only clears unvisited fields, and a
    // reset must leave nothing on screen.
    clearErrors();
  }

  return {
    values,
    errors,
    formError,
    submitting,
    submitted,
    dirty,
    valid,
    touch,
    validate,
    submit,
    reset,
    setErrors,
  };
}

/**
 * The common rules with translated default messages. Messages are getters so
 * a language switch while the dialog is open takes effect on the next check.
 */
export const rules = {
  required: (message?: string) => required(message ?? (() => t("form.required"))),
  minLength: (n: number, message?: string) =>
    minLength(n, message ?? (() => t("form.minLength", { n: String(n) }))),
  maxLength: (n: number, message?: string) =>
    maxLength(n, message ?? (() => t("form.maxLength", { n: String(n) }))),
  pattern: (re: RegExp, message?: string) => pattern(re, message ?? (() => t("form.invalid"))),
  between: (min: number, max: number, message?: string) =>
    between(min, max, message ?? (() => t("form.between", { min: String(min), max: String(max) }))),
};
