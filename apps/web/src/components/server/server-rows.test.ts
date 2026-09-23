import { describe, expect, it } from "vitest";
import {
  cleanPrivilegeKey,
  editValuesOf,
  groupNameProblem,
  parseConnectionInfo,
  parseGroups,
  parsePrivilegeKeys,
  parseServerVariables,
  serverEditPatch,
  type ServerEditValues,
} from "./server-rows";

describe("privilege keys", () => {
  it("parses notifytokenlist rows (as a live server sent them)", () => {
    expect(
      parsePrivilegeKeys([
        {
          token: "NjTAknZXRw8I5Ozt683RLRPan5sfP6NghQenCg+v",
          token_type: "0",
          token_id1: "6",
          token_id2: "0",
          token_created: "1789580828",
          token_description: "default serveradmin privilege key",
          token_customset: "",
        },
        { token_type: "0" },
      ]),
    ).toEqual([
      {
        token: "NjTAknZXRw8I5Ozt683RLRPan5sfP6NghQenCg+v",
        type: 0,
        groupId: "6",
        channelId: null,
        created: 1789580828000,
        description: "default serveradmin privilege key",
      },
    ]);
  });

  it("keeps the channel of a channel group key", () => {
    const [k] = parsePrivilegeKeys([
      { token: "abc=", token_type: "1", token_id1: "5", token_id2: "12" },
    ]);
    expect(k).toMatchObject({ type: 1, groupId: "5", channelId: "12" });
  });

  it("cleans a pasted key: whitespace inside or around goes, anything else is refused", () => {
    expect(cleanPrivilegeKey("  EZyg CxCx\nCBC+/= ")).toBe("EZygCxCxCBC+/=");
    expect(cleanPrivilegeKey("")).toBeNull();
    expect(cleanPrivilegeKey("abc|token=x")).toBeNull();
    expect(cleanPrivilegeKey("x".repeat(101))).toBeNull();
  });
});

describe("connection info", () => {
  it("reads notifyserverconnectioninfo as numbers", () => {
    const info = parseConnectionInfo([
      {
        connection_filetransfer_bandwidth_sent: "0",
        connection_filetransfer_bandwidth_received: "12",
        connection_packets_sent_total: "60075",
        connection_bytes_sent_total: "3542962",
        connection_packets_received_total: "107762",
        connection_bytes_received_total: "8959736",
        connection_bandwidth_sent_last_second_total: "40",
        connection_bandwidth_sent_last_minute_total: "234",
        connection_bandwidth_received_last_second_total: "42",
        connection_bandwidth_received_last_minute_total: "87",
        connection_connected_time: "57316",
        connection_packetloss_total: "0.0125",
        connection_ping: "3.5000",
      },
    ]);
    expect(info).toEqual({
      packetsSent: 60075,
      bytesSent: 3542962,
      packetsReceived: 107762,
      bytesReceived: 8959736,
      bandwidthSentSecond: 40,
      bandwidthSentMinute: 234,
      bandwidthReceivedSecond: 42,
      bandwidthReceivedMinute: 87,
      fileBandwidthSent: 0,
      fileBandwidthReceived: 12,
      connectedSeconds: 57316,
      packetLoss: 0.0125,
      ping: 3.5,
    });
  });

  it("is null without an answer, and 0 for a field that is not a number", () => {
    expect(parseConnectionInfo([])).toBeNull();
    expect(parseConnectionInfo([{ connection_ping: "x" }])?.ping).toBe(0);
  });
});

describe("server variables", () => {
  it("reads the editable fields servergetvariables carries", () => {
    expect(
      parseServerVariables([
        {
          virtualserver_welcomemessage: "Welcome",
          virtualserver_maxclients: "32",
          virtualserver_reserved_slots: "2",
          virtualserver_needed_identity_security_level: "8",
          virtualserver_min_clients_in_channel_before_forced_silence: "100",
          virtualserver_hostmessage: "",
        },
      ]),
    ).toEqual({
      welcomeMessage: "Welcome",
      maxClients: 32,
      reservedSlots: 2,
      securityLevel: 8,
      forcedSilence: 100,
    });
    expect(parseServerVariables([])).toEqual({});
  });
});

describe("groups", () => {
  it("parses a group list, regular groups only, sorted like TeamSpeak", () => {
    const groups = parseGroups(
      [
        { sgid: "3", name: "Server Admin", type: "0", sortid: "0", namemode: "0" },
        { sgid: "7", name: "Normal", type: "1", sortid: "20", namemode: "0", n_modifyp: "75" },
        { sgid: "6", name: "Server Admin", type: "1", sortid: "10", namemode: "2" },
        { sgid: "9", name: "Alpha", type: "1", sortid: "10", namemode: "1" },
        { name: "no id" },
      ],
      "sgid",
    );
    expect(groups.map((g) => g.id)).toEqual(["6", "9", "7"]);
    expect(groups[2]).toEqual({
      id: "7",
      name: "Normal",
      sortId: 20,
      nameMode: 0,
      neededModifyPower: 75,
    });
  });

  it("reads channel groups by cgid", () => {
    expect(parseGroups([{ cgid: "5", name: "CA", type: "1" }], "cgid")[0]?.id).toBe("5");
  });

  it("checks a new name against the limit and the existing names", () => {
    const taken = ["Normal", "Guest"];
    expect(groupNameProblem("Mods", taken)).toBeNull();
    expect(groupNameProblem("  ", taken)).toBe("empty");
    expect(groupNameProblem("x".repeat(31), taken)).toBe("tooLong");
    expect(groupNameProblem(" normal ", taken)).toBe("taken");
  });
});

describe("serverEditPatch", () => {
  const current: ServerEditValues = {
    name: "My server",
    welcomeMessage: "Hi",
    hostMessage: "",
    hostMessageMode: 0,
    hostbannerUrl: "",
    hostbannerGfxUrl: "",
    hostbuttonUrl: "",
    hostbuttonGfxUrl: "",
    maxClients: 32,
    reservedSlots: 0,
    defaultServerGroup: "",
    defaultChannelGroup: "",
    securityLevel: 8,
    forcedSilence: 100,
  };

  it("sends only what changed, under TeamSpeak's names", () => {
    expect(serverEditPatch(current, { ...current, name: " New name ", maxClients: 20 })).toEqual({
      virtualserver_name: "New name",
      virtualserver_maxclients: 20,
    });
  });

  it("is null when nothing changed (whitespace alone is no change)", () => {
    expect(serverEditPatch(current, { ...current })).toBeNull();
    expect(serverEditPatch(current, { ...current, name: "My server " })).toBeNull();
  });

  it("leaves the default groups alone while they are not chosen", () => {
    expect(
      serverEditPatch(current, { ...current, defaultServerGroup: "8", defaultChannelGroup: "" }),
    ).toEqual({ virtualserver_default_server_group: "8" });
  });

  it("clears a URL with an empty string", () => {
    const withBanner = { ...current, hostbannerGfxUrl: "https://x/b.png" };
    expect(serverEditPatch(withBanner, { ...withBanner, hostbannerGfxUrl: " " })).toEqual({
      virtualserver_hostbanner_gfx_url: "",
    });
  });

  it("starts the form from the server info and the variables", () => {
    const values = editValuesOf(
      {
        name: "S",
        welcomeMessage: "from info",
        hostMessage: "hm",
        hostMessageMode: 2,
        hostbannerUrl: "a",
        hostbannerGfxUrl: "b",
        hostbuttonUrl: "c",
        hostbuttonGfxUrl: "d",
        maxClients: 10,
      },
      { welcomeMessage: "fresh", reservedSlots: 1, securityLevel: 20, forcedSilence: 5 },
    );
    expect(values).toEqual({
      name: "S",
      welcomeMessage: "fresh",
      hostMessage: "hm",
      hostMessageMode: 2,
      hostbannerUrl: "a",
      hostbannerGfxUrl: "b",
      hostbuttonUrl: "c",
      hostbuttonGfxUrl: "d",
      maxClients: 10,
      reservedSlots: 1,
      defaultServerGroup: "",
      defaultChannelGroup: "",
      securityLevel: 20,
      forcedSilence: 5,
    });
  });
});
