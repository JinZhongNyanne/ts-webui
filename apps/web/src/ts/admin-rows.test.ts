import { describe, expect, it } from "vitest";
import {
  channelOptions,
  DURATION_PRESETS,
  generatePassword,
  groupComplaints,
  looksLikeUid,
  nicknamePattern,
  pageInfo,
  parseComplaints,
  parseDbEntries,
  parseDbFind,
  parseDbInfos,
  parseMessage,
  parseMessageList,
  parseNamesFromUid,
  parseTempPasswords,
  unreadCount,
} from "./admin-rows";

describe("complaints", () => {
  // As notifycomplainlist delivered them on a live server.
  const rows = [
    {
      tcldbid: "547",
      tname: "bob",
      fcldbid: "546",
      fname: "alice",
      message: "spams",
      timestamp: "1789835926",
    },
    {
      tcldbid: "547",
      tname: "bob",
      fcldbid: "550",
      fname: "carol",
      message: "rude",
      timestamp: "1789835999",
    },
    {
      tcldbid: "600",
      tname: "dave",
      fcldbid: "546",
      fname: "alice",
      message: "afk",
      timestamp: "1789830000",
    },
  ];

  it("parses rows with timestamps in ms", () => {
    const list = parseComplaints(rows);
    expect(list[0]).toEqual({
      targetDbId: "547",
      targetName: "bob",
      fromDbId: "546",
      fromName: "alice",
      message: "spams",
      at: 1789835926000,
    });
  });

  it("skips rows without the ids", () => {
    expect(parseComplaints([{ tname: "x" }, ...rows])).toHaveLength(3);
  });

  it("groups by target, most complained-about first, newest complaint first", () => {
    const groups = groupComplaints(parseComplaints(rows));
    expect(groups.map((g) => [g.targetDbId, g.complaints.length])).toEqual([
      ["547", 2],
      ["600", 1],
    ]);
    expect(groups[0]!.targetName).toBe("bob");
    expect(groups[0]!.complaints.map((c) => c.fromName)).toEqual(["carol", "alice"]);
  });
});

describe("offline messages", () => {
  const list = [
    {
      msgid: "3",
      cluid: "8jiG=",
      subject: "Hello there",
      timestamp: "1789836006",
      flag_read: "1",
    },
    { msgid: "5", cluid: "8jiG=", subject: "Later", timestamp: "1789836008", flag_read: "0" },
    { msgid: "4", cluid: "zz=", subject: "Second", timestamp: "1789836006", flag_read: "0" },
  ];

  it("lists newest first with a read flag", () => {
    const heads = parseMessageList(list);
    expect(heads.map((m) => m.id)).toEqual(["5", "4", "3"]);
    expect(heads[2]).toEqual({
      id: "3",
      fromUid: "8jiG=",
      subject: "Hello there",
      at: 1789836006000,
      read: true,
    });
  });

  it("counts unread", () => {
    expect(unreadCount(parseMessageList(list))).toBe(2);
    expect(unreadCount([])).toBe(0);
  });

  it("parses one message from notifymessage", () => {
    expect(
      parseMessage([
        {
          msgid: "3",
          cluid: "8jiG=",
          subject: "Hi",
          message: "Body [b]x[/b]",
          timestamp: "1789836006",
        },
      ]),
    ).toEqual({
      id: "3",
      fromUid: "8jiG=",
      subject: "Hi",
      body: "Body [b]x[/b]",
      at: 1789836006000,
    });
    expect(parseMessage([])).toBeNull();
  });

  it("reads the names notifyclientnamefromuid returns, one row per UID", () => {
    expect(
      parseNamesFromUid([
        { cluid: "a=", cldbid: "5", name: "alice" },
        { cluid: "b=", cldbid: "6", name: "bob" },
      ]),
    ).toEqual({ "a=": "alice", "b=": "bob" });
    expect(parseNamesFromUid([])).toEqual({});
  });
});

describe("client database", () => {
  const row = (id: string, extra: Record<string, string> = {}) => ({
    cldbid: id,
    client_unique_identifier: `uid${id}=`,
    client_nickname: `n${id}`,
    client_created: "1789580828",
    client_lastconnected: "1789582131",
    client_totalconnections: "3",
    client_description: "",
    client_lastip: "172.17.0.1",
    ...extra,
  });

  it("parses a page and the -count total from its first row", () => {
    const page = parseDbEntries([row("2", { count: "171" }), row("3")]);
    expect(page.total).toBe(171);
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0]).toEqual({
      dbId: "2",
      uid: "uid2=",
      nickname: "n2",
      created: 1789580828000,
      lastConnected: 1789582131000,
      totalConnections: 3,
      description: "",
      lastIp: "172.17.0.1",
    });
    expect(parseDbEntries([row("2")]).total).toBeNull();
    expect(parseDbEntries([])).toEqual({ entries: [], total: null });
  });

  it("reads clientdbinfo, which names the id client_database_id, one row per id", () => {
    const { cldbid: _drop, ...info } = row("9");
    expect(
      parseDbInfos([
        { ...info, client_database_id: "9" },
        { ...info, client_database_id: "4" },
      ]).map((e) => e.dbId),
    ).toEqual(["9", "4"]);
    expect(parseDbInfos([])).toEqual([]);
  });

  it("takes the ids clientdbfind returns, without duplicates", () => {
    expect(parseDbFind([{ cldbid: "5" }, { cldbid: "6" }, { cldbid: "5" }, {}])).toEqual([
      "5",
      "6",
    ]);
  });

  it("wraps a plain search in wildcards, leaves an explicit pattern alone", () => {
    expect(nicknamePattern("  bob ")).toBe("%bob%");
    expect(nicknamePattern("bo%")).toBe("bo%");
    expect(nicknamePattern("")).toBe("");
  });

  it("tells a UID from a nickname", () => {
    expect(looksLikeUid("cDJinVyKGaXAD5Rg+JTdvzrw7kY=")).toBe(true);
    expect(looksLikeUid("bob")).toBe(false);
    expect(looksLikeUid("cDJinVyKGaXAD5Rg JTdvzrw7kY=")).toBe(false);
  });

  it("describes a page", () => {
    expect(pageInfo(0, 25, 171)).toEqual({ page: 1, pages: 7, hasPrev: false, hasNext: true });
    expect(pageInfo(150, 25, 171)).toEqual({ page: 7, pages: 7, hasPrev: true, hasNext: false });
    expect(pageInfo(0, 25, 0)).toEqual({ page: 1, pages: 1, hasPrev: false, hasNext: false });
    // Unknown total: next is possible while pages come back full.
    expect(pageInfo(25, 25, null, 25)).toEqual({
      page: 2,
      pages: null,
      hasPrev: true,
      hasNext: true,
    });
    expect(pageInfo(25, 25, null, 3).hasNext).toBe(false);
  });
});

describe("temporary passwords", () => {
  it("parses notifyservertemppasswordlist", () => {
    const [tp] = parseTempPasswords([
      {
        nickname: "admin",
        uid: "EK1=",
        desc: "probe",
        pw_clear: "probepw",
        start: "1789835928",
        end: "1789835988",
        tcid: "0",
        tcpw: "",
      },
    ]);
    expect(tp).toEqual({
      password: "probepw",
      description: "probe",
      creator: "admin",
      creatorUid: "EK1=",
      start: 1789835928000,
      end: 1789835988000,
      channelId: null,
      channelPassword: "",
    });
    expect(parseTempPasswords([{ pw_clear: "x", tcid: "7", end: "1" }])[0]!.channelId).toBe("7");
    expect(parseTempPasswords([{ desc: "no password" }])).toEqual([]);
  });

  it("offers duration presets in seconds, shortest first", () => {
    const secs = DURATION_PRESETS.map((p) => p.seconds);
    expect(secs[0]).toBe(3600);
    expect([...secs].sort((a, b) => a - b)).toEqual(secs);
    expect(new Set(DURATION_PRESETS.map((p) => p.key)).size).toBe(DURATION_PRESETS.length);
  });
});

describe("generatePassword", () => {
  it("makes passwords of the asked length from unambiguous characters", () => {
    const pw = generatePassword(12);
    expect(pw).toHaveLength(12);
    expect(pw).toMatch(/^[a-km-zA-HJ-NP-Z2-9]+$/);
    expect(generatePassword(3, (b) => b.fill(0))).toBe("aaa");
  });
});

describe("channel options", () => {
  it("lists channels by their path", () => {
    const opts = channelOptions([
      { id: "2", parentId: "1", name: "Sub" },
      { id: "1", parentId: "0", name: "Lobby" },
      { id: "3", parentId: "0", name: "AFK" },
      { id: "4", parentId: "9", name: "Orphan" },
    ]);
    expect(opts).toEqual([
      { id: "3", path: "AFK" },
      { id: "1", path: "Lobby" },
      { id: "2", path: "Lobby / Sub" },
      { id: "4", path: "Orphan" },
    ]);
  });
});
