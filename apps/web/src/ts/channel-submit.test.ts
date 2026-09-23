import { describe, expect, it } from "vitest";
import { TsCommandError } from "./commands";
import { createdChannel, fieldOfError } from "./channel-submit";

describe("fieldOfError", () => {
  it("puts the server's refusals next to the field they are about", () => {
    expect(fieldOfError(new TsCommandError("771", "channel name is already in use"))).toBe("name");
    expect(fieldOfError(new TsCommandError("774", "invalid flags"))).toBe("type");
    expect(fieldOfError(new TsCommandError("776", "parent is not permanent"))).toBe("type");
  });

  it("leaves everything else to the form as a whole", () => {
    expect(fieldOfError(new TsCommandError("2568", "insufficient client permissions"))).toBe(
      undefined,
    );
    expect(fieldOfError(new Error("771"))).toBeUndefined();
    expect(fieldOfError("771")).toBeUndefined();
  });
});

describe("createdChannel", () => {
  const ch = (id: string, parentId: string, name: string) => ({ id, parentId, name });
  const channels = [ch("1", "0", "Lobby"), ch("2", "1", "Games"), ch("3", "0", "Games")];

  it("finds the new channel by parent and name", () => {
    expect(createdChannel(channels, "0", "Games", new Set(["1", "2"]))?.id).toBe("3");
    expect(createdChannel(channels, "1", " Games ", new Set(["1", "3"]))?.id).toBe("2");
  });

  it("never picks a channel that was there before the create", () => {
    expect(createdChannel(channels, "0", "Games", new Set(["1", "2", "3"]))).toBeUndefined();
  });

  it("is undefined when the notify has not brought it", () => {
    expect(createdChannel(channels, "0", "Music", new Set())).toBeUndefined();
  });
});
