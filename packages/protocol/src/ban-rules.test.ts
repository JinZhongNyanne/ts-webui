import { describe, expect, it } from "vitest";
import { banIpProblem, banNameProblem, canonicalIp, sameIp } from "./ban-rules.js";

describe("banIpProblem", () => {
  it("takes literal IPv4 and IPv6 addresses", () => {
    for (const ip of [
      "10.0.0.1",
      "255.255.255.255",
      "0.0.0.0",
      "::1",
      "fd00::dead:1",
      "2001:db8::1",
    ]) {
      expect(banIpProblem(ip)).toBeNull();
    }
  });

  it("refuses patterns, ranges and anything else", () => {
    for (const ip of [
      "",
      "10.0.0.*",
      "10\\.0\\..*",
      ".*",
      "10.0.0.0/8",
      "256.1.1.1",
      "01.2.3.4",
      "1.2.3",
      "localhost",
      "fd00::g",
      "[::1]",
      "1.2.3.4 ",
    ]) {
      expect(banIpProblem(ip)).toBe("tsErr.banIpInvalid");
    }
  });
});

describe("canonicalIp / sameIp", () => {
  it("normalises IPv6 spelling and IPv4-mapped addresses", () => {
    expect(canonicalIp("FD00:0:0::DEAD:1")).toBe(canonicalIp("fd00::dead:1"));
    expect(canonicalIp("::ffff:172.17.0.1")).toBe("172.17.0.1");
    expect(canonicalIp("172.17.0.1")).toBe("172.17.0.1");
    expect(canonicalIp("nope")).toBeNull();
    expect(sameIp("::FFFF:172.17.0.1", "172.17.0.1")).toBe(true);
    expect(sameIp("172.17.0.2", "172.17.0.1")).toBe(false);
    expect(sameIp("x", "x")).toBe(false);
  });
});

describe("banNameProblem", () => {
  it("accepts ordinary nickname patterns", () => {
    for (const name of [
      "^bob$",
      "bob",
      "bob.*",
      ".*bob.*",
      "(?:alice|bob)[0-9]*",
      "Tom\\d+",
      "汉字.*",
    ]) {
      expect(banNameProblem(name)).toBeNull();
    }
  });

  it("refuses what is not a regular expression", () => {
    expect(banNameProblem("[")).toBe("tsErr.banNameInvalid");
    expect(banNameProblem("(a")).toBe("tsErr.banNameInvalid");
    // Only valid once the check wraps it: must not slip through as `^(?:x)|(.*)$`.
    expect(banNameProblem("x)|(.*")).toBe("tsErr.banNameInvalid");
  });

  it("refuses patterns that match everyone (the server matches the whole nickname)", () => {
    for (const name of [
      ".*",
      "^.*$",
      ".+",
      "(.*)",
      "[^]*",
      "\\S*.*",
      "(?:)|.*",
      ".*?",
      "[\\s\\S]*",
    ]) {
      expect(banNameProblem(name)).toBe("tsErr.banNameMatchesAll");
    }
    // Matches the empty nickname only: no one, but nothing a ban is for either.
    expect(banNameProblem("^")).toBe("tsErr.banNameMatchesAll");
  });

  it("refuses nested quantifiers, the catastrophic-backtracking shape", () => {
    for (const name of [
      "(a+)+$",
      "(a*)*b",
      "(?:ab+)*c",
      "((a+)b)+",
      "(a{2,})+",
      "(\\w+\\s?)*$",
      "(a+){2,}",
    ]) {
      expect(banNameProblem(name)).toBe("tsErr.banNameUnsafe");
    }
    // Quantifier characters inside a class or escaped are literals.
    expect(banNameProblem("([+*])+x")).toBeNull();
    expect(banNameProblem("(a\\+)+x")).toBeNull();
    // A bounded group of an optional part is harmless.
    expect(banNameProblem("(ab)?c")).toBeNull();
  });

  it("refuses a pile of unbounded quantifiers", () => {
    expect(banNameProblem("a.*b.*c.*d.*e.*f")).toBe("tsErr.banNameUnsafe");
    expect(banNameProblem("a.*b.*c")).toBeNull();
  });
});
