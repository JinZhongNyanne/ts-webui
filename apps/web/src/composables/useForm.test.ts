import { describe, expect, it, vi } from "vitest";
import { FormError, rules, useForm } from "./useForm";
import { setLocale } from "../i18n";

// `setLocale` writes the document title; node has no document.
vi.stubGlobal("document", { documentElement: {}, title: "" });
setLocale("en");

const make = (onSubmit = vi.fn()) =>
  useForm({
    initial: { name: "", hours: 1, reason: "" },
    rules: {
      name: [rules.required(), rules.maxLength(8)],
      hours: rules.between(1, 24),
    },
    onSubmit,
  });

describe("useForm", () => {
  it("shows no errors before the user reaches a field", () => {
    const form = make();
    expect(form.valid.value).toBe(false);
    expect(form.errors).toEqual({});
    form.values.name = "x";
    form.values.name = "";
    expect(form.errors).toEqual({});
  });

  it("shows a field's error once it is left, then follows typing live", () => {
    const form = make();
    form.touch("name");
    expect(form.errors.name).toBe("Required");
    form.values.name = "alice";
    expect(form.errors.name).toBeUndefined();
    form.values.name = "far-too-long";
    expect(form.errors.name).toBe("At most 8 characters");
  });

  it("does not submit an invalid form and shows every error", async () => {
    const onSubmit = vi.fn();
    const form = make(onSubmit);
    form.values.hours = 99;
    expect(await form.submit()).toBe(false);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(form.errors).toEqual({ name: "Required", hours: "Enter a number from 1 to 24" });
    expect(form.submitted.value).toBe(true);
  });

  it("submits a copy of the values and tracks the in-flight state", async () => {
    let release!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((r) => (release = r)));
    const form = make(onSubmit);
    form.values.name = "alice";

    const pending = form.submit();
    expect(form.submitting.value).toBe(true);
    // A second click while the first is in flight does nothing.
    expect(await form.submit()).toBe(false);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    const sent = onSubmit.mock.calls[0]![0] as { name: string };
    form.values.name = "bob";
    expect(sent.name).toBe("alice");

    release();
    expect(await pending).toBe(true);
    expect(form.submitting.value).toBe(false);
    expect(form.formError.value).toBeNull();
  });

  it("shows a returned message at the form level", async () => {
    const form = make(vi.fn(() => "insufficient client permissions"));
    form.values.name = "alice";
    expect(await form.submit()).toBe(false);
    expect(form.formError.value).toBe("insufficient client permissions");
  });

  it("shows a thrown error at the form level", async () => {
    const form = make(
      vi.fn(async () => {
        throw new Error("timed out");
      }),
    );
    form.values.name = "alice";
    expect(await form.submit()).toBe(false);
    expect(form.formError.value).toBe("timed out");
    expect(form.submitting.value).toBe(false);
  });

  it("falls back to a generic message for a throw without one", async () => {
    const form = make(
      vi.fn(() => {
        throw 42;
      }),
    );
    form.values.name = "alice";
    await form.submit();
    expect(form.formError.value).toBe("That did not work. Please try again.");
  });

  it("maps server field errors, and clears one when its field is edited", async () => {
    const form = make(
      vi.fn(() => {
        throw new FormError("rejected", { name: "name already in use" });
      }),
    );
    form.values.name = "alice";
    await form.submit();
    expect(form.errors.name).toBe("name already in use");
    expect(form.formError.value).toBe("rejected");

    form.values.hours = 2; // another field: the server's message stays
    expect(form.errors.name).toBe("name already in use");
    form.values.name = "alice2";
    expect(form.errors.name).toBeUndefined();
  });

  it("clears the previous form error on the next submit", async () => {
    const results: (string | undefined)[] = ["nope", undefined];
    const form = make(vi.fn(() => results.shift()));
    form.values.name = "alice";
    await form.submit();
    expect(form.formError.value).toBe("nope");
    expect(await form.submit()).toBe(true);
    expect(form.formError.value).toBeNull();
  });

  it("tracks dirty against the initial values", () => {
    const form = make();
    expect(form.dirty.value).toBe(false);
    form.values.reason = "spam";
    expect(form.dirty.value).toBe(true);
    form.values.reason = "";
    expect(form.dirty.value).toBe(false);
  });

  it("reset restores values and hides every error", async () => {
    const form = make();
    form.values.name = "far-too-long";
    await form.submit();
    expect(form.errors.name).toBeDefined();

    form.reset({ name: "bob" });
    expect(form.values).toEqual({ name: "bob", hours: 1, reason: "" });
    expect(form.errors).toEqual({});
    expect(form.submitted.value).toBe(false);
    expect(form.dirty.value).toBe(false);
    // Back to "not reached yet": editing does not show errors until blur.
    form.values.name = "";
    expect(form.errors).toEqual({});
  });

  it("calls an initial() factory again on reset", () => {
    let n = 0;
    const form = useForm({ initial: () => ({ n: ++n }), onSubmit: () => undefined });
    expect(form.values.n).toBe(1);
    form.reset();
    expect(form.values.n).toBe(2);
  });
});
