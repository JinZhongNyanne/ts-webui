import { describe, expect, it } from "vitest";
import { encodeTextCode } from "@jinz/protocol";
import {
  BAN_PRESETS,
  allowsBanTime,
  banLabel,
  chosenSeconds,
  clampBanTime,
  describeBanNotice,
  durationParts,
  filterBans,
  formatBanDuration,
  maxBanTime,
  nicknamePattern,
  parseBan,
  ruleProblem,
  toSeconds,
} from "./bans";

/** A `notifybanlist` row as a live TS3 3.13 server sends it (banclient's UID half). */
const uidRow = {
  banid: "7",
  ip: "",
  name: "",
  uid: "xDHqxK1v8O4wksfXs6GU3ytmses=",
  mytsid: "",
  lastnickname: "victim",
  created: "1789835893",
  duration: "60",
  invokername: "admin",
  invokercldbid: "539",
  invokeruid: "7DlQxPC9TixF/q4//0kZs19RgQ4=",
  reason: "probe banned",
  enforcements: "2",
};

describe("ban durations", () => {
  it("offers 10 min, 1 h, 1 day, 7 days and permanent", () => {
    expect(BAN_PRESETS).toEqual([600, 3600, 86_400, 604_800, 0]);
  });

  it("turns an amount and unit into seconds", () => {
    expect(toSeconds(90, "s")).toBe(90);
    expect(toSeconds(15, "min")).toBe(900);
    expect(toSeconds(2, "h")).toBe(7200);
    expect(toSeconds(3, "d")).toBe(259_200);
    expect(toSeconds(1.5, "min")).toBe(90);
  });

  it("splits seconds into the largest unit that divides them", () => {
    expect(durationParts(259_200)).toEqual({ amount: 3, unit: "d" });
    expect(durationParts(7200)).toEqual({ amount: 2, unit: "h" });
    expect(durationParts(900)).toEqual({ amount: 15, unit: "min" });
    expect(durationParts(61)).toEqual({ amount: 61, unit: "s" });
  });
});

describe("chosenSeconds", () => {
  it("reads a preset or a positive custom amount", () => {
    expect(chosenSeconds("3600", 0, "s")).toBe(3600);
    expect(chosenSeconds("0", 0, "s")).toBe(0);
    expect(chosenSeconds("custom", 2, "d")).toBe(172_800);
    expect(chosenSeconds("custom", 0, "d")).toBeNull();
    expect(chosenSeconds("custom", Number.NaN, "min")).toBeNull();
  });
});

describe("formatBanDuration", () => {
  const fake = (key: string, p: { n: number }) => `${key}:${p.n}`;

  it("words a length in its largest even unit", () => {
    expect(formatBanDuration(604_800, fake)).toBe("ban.dur.d:7");
    expect(formatBanDuration(600, fake)).toBe("ban.dur.min:10");
    expect(formatBanDuration(45, fake)).toBe("ban.dur.s:45");
    expect(formatBanDuration(0, fake)).toBe("ban.permanent:0");
  });
});

describe("describeBanNotice", () => {
  const fake = (key: string, p: Record<string, string | number>) =>
    `${key}(${Object.entries(p)
      .map(([k, v]) => `${k}=${v}`)
      .join(",")})`;
  const code = (params: Record<string, string>) => encodeTextCode("hub.bannedBy", params);

  it("says who banned us, for how long and why", () => {
    expect(describeBanNotice(code({ name: "Ann", reason: "spam", seconds: "3600" }), fake)).toBe(
      "hub.bannedBy(name=Ann,time=ban.dur.h(n=1),reason=spam)",
    );
  });

  it("leaves out a blank reason and words 0 as permanent", () => {
    expect(describeBanNotice(code({ name: "Ann", reason: " ", seconds: "0" }), fake)).toBe(
      "hub.bannedByNoReason(name=Ann,time=ban.permanent(n=0))",
    );
  });
});

describe("i_client_ban_max_bantime", () => {
  const perms = (v?: number) => (v === undefined ? {} : { i_client_ban_max_bantime: v });

  it("caps only when the server told us a positive limit", () => {
    expect(maxBanTime(perms(3600), true)).toBe(3600);
    expect(maxBanTime(perms(-1), true)).toBeNull();
    expect(maxBanTime(perms(), true)).toBeNull();
    expect(maxBanTime(perms(0), true)).toBeNull();
    expect(maxBanTime(perms(3600), false)).toBeNull();
  });

  it("allows what fits under the cap; permanent never does", () => {
    expect(allowsBanTime(600, 3600)).toBe(true);
    expect(allowsBanTime(3600, 3600)).toBe(true);
    expect(allowsBanTime(3601, 3600)).toBe(false);
    expect(allowsBanTime(0, 3600)).toBe(false);
    expect(allowsBanTime(0, null)).toBe(true);
  });

  it("clamps a duration to the cap", () => {
    expect(clampBanTime(86_400, 3600)).toBe(3600);
    expect(clampBanTime(0, 3600)).toBe(3600);
    expect(clampBanTime(600, 3600)).toBe(600);
    expect(clampBanTime(0, null)).toBe(0);
  });
});

describe("ban list rows", () => {
  it("parses a notifybanlist row", () => {
    expect(parseBan(uidRow)).toEqual({
      id: "7",
      ip: "",
      name: "",
      uid: "xDHqxK1v8O4wksfXs6GU3ytmses=",
      lastNickname: "victim",
      reason: "probe banned",
      invokerName: "admin",
      invokerUid: "7DlQxPC9TixF/q4//0kZs19RgQ4=",
      created: 1_789_835_893_000,
      duration: 60,
      expires: 1_789_835_953_000,
      enforcements: 2,
    });
  });

  it("gives a permanent ban no expiry and tolerates missing fields", () => {
    const b = parseBan({ banid: "3", duration: "0", created: "x" });
    expect(b.expires).toBeNull();
    expect(b.created).toBe(0);
    expect(b.enforcements).toBe(0);
    expect(b.ip).toBe("");
  });

  it("searches every text column, ignoring case", () => {
    const bans = [
      parseBan(uidRow),
      parseBan({ ...uidRow, banid: "8", uid: "", ip: "172.17.0.1", reason: "Spam" }),
    ];
    const ids = (q: string) => filterBans(bans, q).map((b) => b.id);
    expect(ids("")).toEqual(["7", "8"]);
    expect(ids("172.17")).toEqual(["8"]);
    expect(ids("SPAM")).toEqual(["8"]);
    expect(ids("victim")).toEqual(["7", "8"]);
    expect(ids("xdhq")).toEqual(["7"]);
    expect(ids("nobody")).toEqual([]);
  });
});

describe("nicknamePattern", () => {
  it("matches exactly that nickname, regex characters escaped", () => {
    expect(nicknamePattern("bob")).toBe("^bob$");
    expect(nicknamePattern("a.b (x)")).toBe("^a\\.b \\(x\\)$");
    expect(new RegExp(nicknamePattern("a.b+")).test("a.b+")).toBe(true);
    expect(new RegExp(nicknamePattern("a.b+")).test("axbb")).toBe(false);
  });
});

describe("banLabel", () => {
  const ban = (row: Record<string, string>) => parseBan({ banid: "3", ...row });
  it("names a ban by who or what it matches, most readable first", () => {
    expect(banLabel(ban({ lastnickname: "Victim", uid: "abc=" }))).toBe("Victim");
    expect(banLabel(ban({ name: "^bob$", ip: "1.2.3.4" }))).toBe("^bob$");
    expect(banLabel(ban({ ip: "1.2.3.4", uid: "abc=" }))).toBe("1.2.3.4");
    expect(banLabel(ban({ uid: "abc=" }))).toBe("abc=");
    expect(banLabel(ban({}))).toBe("#3");
  });
});

describe("ruleProblem", () => {
  it("checks the IP and nickname fields as the hub will (ban-rules.ts)", () => {
    expect(ruleProblem("ip", "10.0.0.1")).toBeNull();
    expect(ruleProblem("ip", " 10.0.0.1 ")).toBeNull();
    expect(ruleProblem("ip", "10.0.*")).toBe("tsErr.banIpInvalid");
    expect(ruleProblem("name", "^bob$")).toBeNull();
    expect(ruleProblem("name", ".*")).toBe("tsErr.banNameMatchesAll");
    expect(ruleProblem("name", "(a+)+")).toBe("tsErr.banNameUnsafe");
    expect(ruleProblem("name", "[")).toBe("tsErr.banNameInvalid");
    // Blank fields are simply not part of the rule.
    expect(ruleProblem("ip", "  ")).toBeNull();
    expect(ruleProblem("name", "")).toBeNull();
  });

  it("accepts what “match this nickname only” builds, odd characters and all", () => {
    for (const nick of ["bob", "a.b (x)", "Tom+*?", "测试", "[x]{2,}"]) {
      expect(ruleProblem("name", nicknamePattern(nick))).toBeNull();
    }
  });
});
