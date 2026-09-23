import { describe, expect, it } from "vitest";
import { clientFromParams, clientPatchFromParams, connectionIpOf } from "./parse.js";

describe("connectionIpOf", () => {
  // As a live TS3 3.13 server answered `getconnectioninfo clid=<self>` to a guest.
  const INFO = {
    clid: "948",
    connection_client_ip: "172.17.0.1",
    connection_client_port: "59321",
    connection_idle_time: "1496",
  };

  it("finds the address the server sees for one client", () => {
    expect(connectionIpOf([INFO], 948)).toBe("172.17.0.1");
    expect(connectionIpOf([{ ...INFO, clid: "3" }, INFO], 948)).toBe("172.17.0.1");
  });

  it("is null when the row is not there or has no address", () => {
    expect(connectionIpOf([INFO], 5)).toBeNull();
    expect(connectionIpOf([{ clid: "948" }], 948)).toBeNull();
    expect(connectionIpOf([], 948)).toBeNull();
  });
});

/** The M1 client fields as a live TS3 server sends them in notifycliententerview. */
const ENTER = {
  clid: "7",
  client_nickname: "alice",
  client_flag_avatar: "2CD8BDE463F5D82AAE0F0CEC061D6B8F",
  client_description: "hello there",
  client_talk_request: "1789815660",
  client_talk_request_msg: "pls",
};

describe("client avatar, description and talk request", () => {
  it("reads them from an enter view", () => {
    const c = clientFromParams(ENTER, 1);
    expect(c.avatar).toBe("2cd8bde463f5d82aae0f0cec061d6b8f");
    expect(c.description).toBe("hello there");
    // The server sends the request time, not a 1.
    expect(c.talkRequest).toBe(true);
    expect(c.talkRequestMessage).toBe("pls");
  });

  it("defaults to none when the fields are missing or empty", () => {
    const c = clientFromParams({ clid: "7", client_flag_avatar: "", client_talk_request: "0" }, 1);
    expect(c.avatar).toBe("");
    expect(c.description).toBe("");
    expect(c.talkRequest).toBe(false);
    expect(c.talkRequestMessage).toBe("");
  });

  it("drops an avatar hash that is not hex, since it ends up in a URL", () => {
    expect(clientFromParams({ clid: "7", client_flag_avatar: "../x" }, 1).avatar).toBe("");
  });

  it("patches only what an update carries", () => {
    expect(clientPatchFromParams({ clid: "7", client_flag_avatar: "" })).toEqual({ avatar: "" });
    expect(clientPatchFromParams({ clid: "7", client_talk_request: "0" })).toEqual({
      talkRequest: false,
    });
    expect(
      clientPatchFromParams({ clid: "7", client_talk_request: "17", client_talk_request_msg: "x" }),
    ).toEqual({ talkRequest: true, talkRequestMessage: "x" });
    expect(clientPatchFromParams({ clid: "7", client_description: "d" })).toEqual({
      description: "d",
    });
    expect(clientPatchFromParams({ clid: "7", client_nickname: "n" })).not.toHaveProperty("avatar");
  });
});
