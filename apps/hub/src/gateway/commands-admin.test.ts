/**
 * Wire forms of the M2 admin tool commands, checked against what a live
 * TeamSpeak 3 server accepted and which notify it answered with.
 */
import { describe, expect, it } from "vitest";
import { TsCmdRequestSchema, type TsCmdRequest } from "@jinz/protocol";
import { prepareTsCommand, repairDirectRows } from "./commands.js";

describe("repairDirectRows", () => {
  // The client library parses a nameless answer row ("k=v k=v") as a command
  // called "k=v" and keeps that first value escaped; the rest are fine.
  const UID = "client_unique_identifier";

  it("unescapes the expected first field of the first row", () => {
    const rows = [
      { [UID]: "ab\\/c+d=", client_nickname: "bob smith" },
      { [UID]: "x/y", client_nickname: "z" },
    ];
    expect(repairDirectRows(rows, UID)).toEqual([
      { [UID]: "ab/c+d=", client_nickname: "bob smith" },
      { [UID]: "x/y", client_nickname: "z" },
    ]);
    expect(repairDirectRows([], UID)).toEqual([]);
  });

  it("leaves rows alone without an expected field, or when it is not first", () => {
    expect(repairDirectRows([{ a: "one\\stwo" }])).toEqual([{ a: "one\\stwo" }]);
    // A valueless first field is dropped by the library; the next is already clean.
    expect(repairDirectRows([{ client_nickname: "a\\sb", [UID]: "x" }], UID)).toEqual([
      { client_nickname: "a\\sb", [UID]: "x" },
    ]);
  });

  it("does not change its input", () => {
    const rows = [{ [UID]: "x\\/y" }];
    repairDirectRows(rows, UID);
    expect(rows[0]![UID]).toBe("x\\/y");
  });
});

function prep(cmd: string, args: unknown) {
  const req = TsCmdRequestSchema.parse({ type: "ts.cmd", id: "r1", cmd, args }) as TsCmdRequest;
  return prepareTsCommand(req);
}

describe("complaint commands", () => {
  it("files one with the message escaped", () => {
    expect(prep("complainadd", { tcldbid: "5", message: "spams | links" })).toEqual({
      text: "complainadd tcldbid=5 message=spams\\s\\p\\slinks",
      collect: null,
    });
  });

  it("lists all or one target's through notifycomplainlist", () => {
    expect(prep("complainlist", {})).toEqual({
      text: "complainlist",
      collect: "notifycomplainlist",
    });
    expect(prep("complainlist", { tcldbid: "5" }).text).toBe("complainlist tcldbid=5");
  });

  it("deletes one or all of a target's", () => {
    expect(prep("complaindel", { tcldbid: "5", fcldbid: "6" }).text).toBe(
      "complaindel tcldbid=5 fcldbid=6",
    );
    expect(prep("complaindelall", { tcldbid: "5" }).text).toBe("complaindelall tcldbid=5");
  });
});

describe("offline message commands", () => {
  it("lists and reads through their notifies", () => {
    expect(prep("messagelist", {})).toEqual({ text: "messagelist", collect: "notifymessagelist" });
    expect(prep("messageget", { msgid: "3" })).toEqual({
      text: "messageget msgid=3",
      collect: "notifymessage",
    });
  });

  it("flags, deletes and sends", () => {
    expect(prep("messageupdateflag", { msgid: "3", flag: true }).text).toBe(
      "messageupdateflag msgid=3 flag=1",
    );
    expect(prep("messagedel", { msgid: "3" }).text).toBe("messagedel msgid=3");
    expect(
      prep("messageadd", { cluid: "ab/c+d=", subject: "Hi there", message: "[b]x[/b]" }).text,
    ).toBe("messageadd cluid=ab\\/c+d= subject=Hi\\sthere message=[b]x[\\/b]");
  });

  it("resolves UIDs to names, one row each (a live server answers each with a notify)", () => {
    expect(prep("clientgetnamefromuid", { cluids: ["abc="] })).toEqual({
      text: "clientgetnamefromuid cluid=abc=",
      collect: "notifyclientnamefromuid",
    });
    expect(prep("clientgetnamefromuid", { cluids: ["a/b=", "c="] }).text).toBe(
      "clientgetnamefromuid cluid=a\\/b=|cluid=c=",
    );
  });
});

describe("client database commands", () => {
  it("pages with -count as a wire flag", () => {
    expect(prep("clientdblist", { start: 25, duration: 25, count: true })).toEqual({
      text: "clientdblist start=25 duration=25 -count",
      collect: "notifyclientdblist",
    });
    expect(prep("clientdblist", { start: 0, duration: 10 }).text).toBe(
      "clientdblist start=0 duration=10",
    );
  });

  it("searches by nickname pattern or exact UID", () => {
    expect(prep("clientdbfind", { pattern: "%bob smith%" })).toEqual({
      text: "clientdbfind pattern=%bob\\ssmith%",
      collect: "notifyclientdbfind",
    });
    expect(prep("clientdbfind", { pattern: "ab/c=", uid: true }).text).toBe(
      "clientdbfind pattern=ab\\/c= -uid",
    );
  });

  it("reads (answered directly), edits and deletes an entry", () => {
    expect(prep("clientdbinfo", { cldbids: ["9"] })).toEqual({
      text: "clientdbinfo cldbid=9",
      collect: null,
      firstField: "client_unique_identifier",
    });
    // A page of search hits in one command (checked live: one answer row each).
    expect(prep("clientdbinfo", { cldbids: ["9", "12"] }).text).toBe(
      "clientdbinfo cldbid=9|cldbid=12",
    );
    expect(prep("clientdbedit", { cldbid: "9", client_description: "a b" }).text).toBe(
      "clientdbedit cldbid=9 client_description=a\\sb",
    );
    expect(prep("clientdbdelete", { cldbid: "9" }).text).toBe("clientdbdelete cldbid=9");
  });
});

describe("temporary password commands", () => {
  it("lists through notifyservertemppasswordlist", () => {
    expect(prep("servertemppasswordlist", {})).toEqual({
      text: "servertemppasswordlist",
      collect: "notifyservertemppasswordlist",
    });
  });

  it("adds with no target channel as tcid=0", () => {
    expect(
      prep("servertemppasswordadd", { pw: "p w", desc: "for guests", duration: 3600 }).text,
    ).toBe("servertemppasswordadd pw=p\\sw desc=for\\sguests duration=3600 tcid=0 tcpw=");
    expect(
      prep("servertemppasswordadd", { pw: "x", desc: "", duration: 60, tcid: "7", tcpw: "c" }).text,
    ).toBe("servertemppasswordadd pw=x desc= duration=60 tcid=7 tcpw=c");
  });

  it("deletes by password", () => {
    expect(prep("servertemppassworddel", { pw: "p|w" }).text).toBe(
      "servertemppassworddel pw=p\\pw",
    );
  });
});
