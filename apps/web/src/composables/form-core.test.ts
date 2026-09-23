import { describe, expect, it } from "vitest";
import {
  between,
  checkAll,
  checkField,
  fingerprint,
  FormError,
  isBlank,
  maxLength,
  minLength,
  pattern,
  required,
  thrownToFailure,
  toSubmitFailure,
  type Rules,
} from "./form-core";

interface Ban {
  name: string;
  hours: number;
  reason: string;
  repeat: string;
}

const values = (over: Partial<Ban> = {}): Ban => ({
  name: "alice",
  hours: 1,
  reason: "",
  repeat: "alice",
  ...over,
});

const rules: Rules<Ban> = {
  name: [required("need a name"), maxLength(8, "too long")],
  hours: between(1, 24, "1-24"),
  repeat: (v, all) => (v !== all.name ? "does not match" : null),
};

describe("checkField / checkAll", () => {
  it("passes a valid form", () => {
    expect(checkAll(rules, values())).toEqual({});
  });

  it("reports the first failing rule of a field", () => {
    expect(checkField(rules, "name", values({ name: "" }))).toBe("need a name");
    expect(checkField(rules, "name", values({ name: "a-very-long-name" }))).toBe("too long");
  });

  it("accepts a single rule as well as a list", () => {
    expect(checkField(rules, "hours", values({ hours: 99 }))).toBe("1-24");
  });

  it("gives cross-field rules the whole form", () => {
    expect(checkAll(rules, values({ repeat: "bob" }))).toEqual({ repeat: "does not match" });
  });

  it("treats a field without rules as valid", () => {
    expect(checkField(rules, "reason", values())).toBeNull();
  });
});

describe("built-in rules", () => {
  it("isBlank covers the empty shapes a form produces", () => {
    for (const v of ["", "   ", null, undefined, [], Number.NaN]) expect(isBlank(v)).toBe(true);
    for (const v of ["x", 0, false, [1]]) expect(isBlank(v)).toBe(false);
  });

  it("length rules count characters, not UTF-16 units", () => {
    // Two emoji are two characters but four code units.
    expect(maxLength(2, "long")("😀😀")).toBeNull();
    expect(minLength(3, "short")("😀😀")).toBe("short");
  });

  it("leaves an empty value to `required`", () => {
    expect(minLength(3, "short")("")).toBeNull();
    expect(pattern(/^\d+$/, "digits")("")).toBeNull();
    expect(between(1, 5, "range")(Number.NaN)).toBeNull();
  });

  it("pattern and between check what is there", () => {
    expect(pattern(/^\d+$/, "digits")("12a")).toBe("digits");
    expect(between(1, 5, "range")(0)).toBe("range");
    expect(between(1, 5, "range")(5)).toBeNull();
  });

  it("reads getter messages at check time", () => {
    let lang = "en";
    const rule = required(() => (lang === "en" ? "Required" : "必填"));
    expect(rule("")).toBe("Required");
    lang = "zh";
    expect(rule("")).toBe("必填");
  });
});

describe("toSubmitFailure", () => {
  it("counts nothing, true or a returned record as success", () => {
    for (const r of [undefined, null, true, { id: 3 }, ""]) expect(toSubmitFailure(r)).toBeNull();
  });

  it("turns a returned message into a form error", () => {
    expect(toSubmitFailure("insufficient permissions")).toEqual({
      form: "insufficient permissions",
    });
  });

  it("keeps only string field messages", () => {
    expect(toSubmitFailure({ fields: { name: "taken", hours: 3, reason: "" } })).toEqual({
      form: undefined,
      fields: { name: "taken" },
    });
  });

  it("treats an empty failure object as success", () => {
    expect(toSubmitFailure({ form: "", fields: {} })).toBeNull();
  });
});

describe("thrownToFailure", () => {
  it("uses an Error's message", () => {
    expect(thrownToFailure(new Error("timed out"), "failed")).toEqual({ form: "timed out" });
  });

  it("carries a FormError's field messages", () => {
    const err = new FormError<Ban>("rejected", { name: "taken" });
    expect(thrownToFailure(err, "failed")).toEqual({ form: "rejected", fields: { name: "taken" } });
  });

  it("never mistakes a throw for success", () => {
    expect(thrownToFailure(undefined, "failed")).toEqual({ form: "failed" });
    expect(thrownToFailure(new Error(""), "failed")).toEqual({ form: "failed" });
    expect(thrownToFailure("plain string", "failed")).toEqual({ form: "plain string" });
  });
});

describe("fingerprint", () => {
  it("sees in-place list edits and ignores identity", () => {
    const list = [1, 2];
    const before = fingerprint(list);
    list.push(3);
    expect(fingerprint(list)).not.toBe(before);
    expect(fingerprint([1, 2, 3])).toBe(fingerprint(list));
  });

  it("does not throw on circular values", () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(typeof fingerprint(a)).toBe("string");
  });
});
