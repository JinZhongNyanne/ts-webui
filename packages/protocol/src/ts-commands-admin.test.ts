import { describe, expect, it } from "vitest";
import { TS_CMD_NAMES, TsCmdRequestSchema } from "./ts-commands.js";
import {
  CLIENT_DB_INFO_MAX,
  NAME_LOOKUP_MAX,
  tsWireLength,
  utf8Length,
} from "./ts-commands-admin.js";

const ok = (name: string, args: unknown) =>
  TsCmdRequestSchema.safeParse({ type: "ts.cmd", id: "c1", cmd: name, args }).success;

const UID = "cDJinVyKGaXAD5Rg+JTdvzrw7kY=";

describe("M2 admin tool commands", () => {
  it("are all on the allow list", () => {
    for (const name of [
      "complainadd",
      "complainlist",
      "complaindel",
      "complaindelall",
      "messagelist",
      "messageget",
      "messageupdateflag",
      "messagedel",
      "messageadd",
      "clientgetnamefromuid",
      "clientdblist",
      "clientdbfind",
      "clientdbinfo",
      "clientdbedit",
      "clientdbdelete",
      "servertemppasswordlist",
      "servertemppasswordadd",
      "servertemppassworddel",
    ]) {
      expect(TS_CMD_NAMES).toContain(name);
    }
  });

  it("complaints: database ids and a message of at most 200 characters", () => {
    expect(ok("complainadd", { tcldbid: "5", message: "spam" })).toBe(true);
    expect(ok("complainadd", { tcldbid: "5", message: "" })).toBe(false);
    expect(ok("complainadd", { tcldbid: "5", message: "x".repeat(201) })).toBe(false);
    expect(ok("complainadd", { tcldbid: "5 x=1", message: "a" })).toBe(false);
    expect(ok("complainlist", {})).toBe(true);
    expect(ok("complainlist", { tcldbid: "5" })).toBe(true);
    expect(ok("complaindel", { tcldbid: "5", fcldbid: "6" })).toBe(true);
    expect(ok("complaindel", { tcldbid: "5" })).toBe(false);
    expect(ok("complaindelall", { tcldbid: "5" })).toBe(true);
  });

  it("offline messages: ids, a UID, subject ≤ 200 and body ≤ 4096", () => {
    expect(ok("messagelist", {})).toBe(true);
    expect(ok("messageget", { msgid: "3" })).toBe(true);
    expect(ok("messageget", { msgid: 3 })).toBe(false);
    expect(ok("messageupdateflag", { msgid: "3", flag: true })).toBe(true);
    expect(ok("messageupdateflag", { msgid: "3" })).toBe(false);
    expect(ok("messagedel", { msgid: "3" })).toBe(true);
    expect(ok("messageadd", { cluid: UID, subject: "Hi", message: "Body" })).toBe(true);
    expect(ok("messageadd", { cluid: UID, subject: "", message: "Body" })).toBe(false);
    expect(ok("messageadd", { cluid: UID, subject: "x".repeat(201), message: "b" })).toBe(false);
    expect(ok("messageadd", { cluid: UID, subject: "s", message: "x".repeat(4097) })).toBe(false);
    expect(ok("messageadd", { cluid: "not a uid", subject: "s", message: "b" })).toBe(false);
    // Characters count, but a body of mostly CJK text is also held to 8000 bytes.
    expect(ok("messageadd", { cluid: UID, subject: "汉".repeat(200), message: "汉" })).toBe(true);
    expect(ok("messageadd", { cluid: UID, subject: "s", message: "汉".repeat(2666) })).toBe(true);
    expect(ok("messageadd", { cluid: UID, subject: "s", message: "汉".repeat(2667) })).toBe(false);
    // Several UIDs in one command (one row each), so an inbox is one lookup.
    expect(ok("clientgetnamefromuid", { cluids: [UID] })).toBe(true);
    expect(ok("clientgetnamefromuid", { cluids: [UID, "abc="] })).toBe(true);
    expect(ok("clientgetnamefromuid", { cluids: [] })).toBe(false);
    expect(ok("clientgetnamefromuid", { cluids: [""] })).toBe(false);
    expect(ok("clientgetnamefromuid", { cluids: Array(NAME_LOOKUP_MAX + 1).fill(UID) })).toBe(
      false,
    );
    expect(ok("clientgetnamefromuid", { cluid: UID })).toBe(false);
  });

  it("client database: bounded pages, a plain search pattern, a short description", () => {
    expect(ok("clientdblist", { start: 0, duration: 25, count: true })).toBe(true);
    expect(ok("clientdblist", { start: -1, duration: 25 })).toBe(false);
    expect(ok("clientdblist", { start: 1e300, duration: 25 })).toBe(false);
    expect(ok("clientdblist", { start: 0, duration: 0 })).toBe(false);
    expect(ok("clientdblist", { start: 0, duration: 201 })).toBe(false);
    expect(ok("clientdbfind", { pattern: "%bob%" })).toBe(true);
    expect(ok("clientdbfind", { pattern: UID, uid: true })).toBe(true);
    expect(ok("clientdbfind", { pattern: "" })).toBe(false);
    // Details for a whole page of hits in one command.
    expect(ok("clientdbinfo", { cldbids: ["9"] })).toBe(true);
    expect(ok("clientdbinfo", { cldbids: ["9", "10"] })).toBe(true);
    expect(ok("clientdbinfo", { cldbids: [] })).toBe(false);
    expect(ok("clientdbinfo", { cldbids: Array(CLIENT_DB_INFO_MAX + 1).fill("9") })).toBe(false);
    expect(ok("clientdbinfo", { cldbid: "9" })).toBe(false);
    expect(ok("clientdbedit", { cldbid: "9", client_description: "" })).toBe(true);
    expect(ok("clientdbedit", { cldbid: "9", client_description: "x".repeat(201) })).toBe(false);
    expect(ok("clientdbedit", { cldbid: "9", client_nickname: "x" })).toBe(false);
    expect(ok("clientdbdelete", { cldbid: "9" })).toBe(true);
  });

  it("temporary passwords: password, description, a positive duration, optional channel", () => {
    expect(ok("servertemppasswordlist", {})).toBe(true);
    const base = { pw: "secret", desc: "guests", duration: 3600 };
    expect(ok("servertemppasswordadd", base)).toBe(true);
    expect(ok("servertemppasswordadd", { ...base, tcid: "7", tcpw: "x" })).toBe(true);
    expect(ok("servertemppasswordadd", { ...base, pw: "" })).toBe(false);
    expect(ok("servertemppasswordadd", { ...base, pw: "x".repeat(129) })).toBe(false);
    expect(ok("servertemppasswordadd", { ...base, desc: "x".repeat(256) })).toBe(false);
    expect(ok("servertemppasswordadd", { ...base, duration: 0 })).toBe(false);
    expect(ok("servertemppasswordadd", { ...base, duration: 1.5 })).toBe(false);
    expect(ok("servertemppassworddel", { pw: "secret" })).toBe(true);
    expect(ok("servertemppassworddel", { pw: "" })).toBe(false);
  });
});

describe("text size helpers", () => {
  it("count UTF-8 bytes, and bytes once escaped for the wire", () => {
    expect(utf8Length("ab")).toBe(2);
    expect(utf8Length("汉")).toBe(3);
    // Space, pipe, slash, backslash and the control escapes take two bytes each.
    expect(tsWireLength("a b|c/d\\e\nf\tg")).toBe(utf8Length("a b|c/d\\e\nf\tg") + 6);
    expect(tsWireLength("汉")).toBe(3);
  });
});
