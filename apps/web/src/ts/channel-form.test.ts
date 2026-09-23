import { describe, expect, it } from "vitest";
import type { TsChannel } from "@jinz/protocol";
import { checkAll } from "../composables/form-core";
import {
  channelFormRules,
  channelType,
  createArgs,
  editArgs,
  formFromChannel,
  iconChange,
  newChannelForm,
  orderChoices,
  type ChannelFormValues,
} from "./channel-form";

function channel(
  over: Partial<TsChannel> = {},
  flags: Partial<TsChannel["flags"]> = {},
): TsChannel {
  return {
    id: "7",
    parentId: "1",
    order: "3",
    name: "Room",
    namePhonetic: "",
    topic: "hello",
    codec: 4,
    codecQuality: 6,
    maxClients: -1,
    maxFamilyClients: -1,
    neededTalkPower: 0,
    iconId: 0,
    deleteDelay: 0,
    subscribed: true,
    ...over,
    flags: {
      permanent: false,
      semiPermanent: true,
      default: false,
      password: false,
      maxClientsUnlimited: true,
      maxFamilyClientsUnlimited: true,
      maxFamilyClientsInherited: false,
      ...flags,
    },
  };
}

const MSG = (key: string) => key;

describe("formFromChannel", () => {
  it("reads the channel into form values", () => {
    const v = formFromChannel(
      channel(
        { maxClients: 5, maxFamilyClients: 9, iconId: 42 },
        { password: true, maxClientsUnlimited: false, maxFamilyClientsUnlimited: false },
      ),
      "[b]d[/b]",
    );
    expect(v).toMatchObject({
      name: "Room",
      topic: "hello",
      description: "[b]d[/b]",
      hasPassword: true,
      password: "",
      maxClientsLimited: true,
      maxClients: 5,
      familyMode: "limited",
      maxFamilyClients: 9,
      type: "semi",
      order: "3",
      iconId: 42,
    });
  });

  it("knows the three channel types and inherited family limits", () => {
    expect(channelType(channel({}, { permanent: true, semiPermanent: false }))).toBe("permanent");
    expect(channelType(channel({}, { semiPermanent: false }))).toBe("temporary");
    expect(formFromChannel(channel({}, { maxFamilyClientsInherited: true }), "").familyMode).toBe(
      "inherit",
    );
    expect(formFromChannel(channel(), "").familyMode).toBe("unlimited");
  });
});

describe("createArgs", () => {
  it("sends only what differs from the server's defaults", () => {
    const v = { ...newChannelForm("semi", "3"), name: "  New  ", quality: 5 };
    expect(createArgs(v, "1", "3")).toEqual({
      cpid: "1",
      channel_name: "New",
      channel_flag_semi_permanent: true,
    });
  });

  it("top level channels have no cpid", () => {
    expect(createArgs({ ...newChannelForm("permanent", "0"), name: "x" }, "0", "0")).toMatchObject({
      channel_flag_permanent: true,
    });
    expect(
      createArgs({ ...newChannelForm("permanent", "0"), name: "x" }, "0", "0"),
    ).not.toHaveProperty("cpid");
  });

  it("sends every field the user set", () => {
    const v: ChannelFormValues = {
      ...newChannelForm("temporary", "3"),
      name: "Sub",
      namePhonetic: "sub",
      topic: "t",
      description: "d",
      hasPassword: true,
      password: "pw",
      codec: 5,
      quality: 10,
      maxClientsLimited: true,
      maxClients: 4,
      familyMode: "inherit",
      neededTalkPower: 3,
      order: "0",
      deleteDelay: 60,
    };
    expect(createArgs(v, "1", "3")).toEqual({
      cpid: "1",
      channel_name: "Sub",
      channel_name_phonetic: "sub",
      channel_topic: "t",
      channel_description: "d",
      channel_password: "pw",
      channel_codec: 5,
      channel_codec_quality: 10,
      channel_maxclients: 4,
      channel_flag_maxclients_unlimited: false,
      channel_flag_maxfamilyclients_inherited: true,
      channel_needed_talk_power: 3,
      channel_order: "0",
      channel_delete_delay: 60,
    });
  });

  it("a limited family sends the number and clears both other flags", () => {
    const v = {
      ...newChannelForm("semi", "3"),
      name: "x",
      familyMode: "limited" as const,
      maxFamilyClients: 8,
    };
    expect(createArgs(v, "1", "3")).toMatchObject({
      channel_maxfamilyclients: 8,
      channel_flag_maxfamilyclients_unlimited: false,
      channel_flag_maxfamilyclients_inherited: false,
    });
  });

  it("a password is only sent when protection is on", () => {
    const v = {
      ...newChannelForm("semi", "3"),
      name: "x",
      hasPassword: false,
      password: "left over",
    };
    expect(createArgs(v, "1", "3")).not.toHaveProperty("channel_password");
  });

  it("the default channel goes out as permanent", () => {
    const v = { ...newChannelForm("permanent", "3"), name: "x", isDefault: true };
    expect(createArgs(v, "0", "3")).toMatchObject({
      channel_flag_permanent: true,
      channel_flag_default: true,
    });
  });
});

describe("editArgs", () => {
  const initial = formFromChannel(channel(), "desc");

  it("returns null when nothing changed", () => {
    expect(editArgs("7", initial, { ...initial })).toBeNull();
  });

  it("sends only the fields that changed", () => {
    expect(editArgs("7", initial, { ...initial, name: "Renamed", topic: "new" })).toEqual({
      cid: "7",
      channel_name: "Renamed",
      channel_topic: "new",
    });
    expect(editArgs("7", initial, { ...initial, description: "" })).toEqual({
      cid: "7",
      channel_description: "",
    });
  });

  it("password: blank keeps it, off removes it, a new one replaces it", () => {
    const locked = formFromChannel(channel({}, { password: true }), "");
    expect(editArgs("7", locked, { ...locked })).toBeNull();
    expect(editArgs("7", locked, { ...locked, hasPassword: false })).toEqual({
      cid: "7",
      channel_password: "",
    });
    expect(editArgs("7", locked, { ...locked, password: "new" })).toEqual({
      cid: "7",
      channel_password: "new",
    });
    expect(editArgs("7", initial, { ...initial, hasPassword: true, password: "pw" })).toEqual({
      cid: "7",
      channel_password: "pw",
    });
  });

  it("limits go out with their flags", () => {
    expect(editArgs("7", initial, { ...initial, maxClientsLimited: true, maxClients: 3 })).toEqual({
      cid: "7",
      channel_maxclients: 3,
      channel_flag_maxclients_unlimited: false,
    });
    const limited = { ...initial, maxClientsLimited: true, maxClients: 3 };
    expect(editArgs("7", limited, { ...limited, maxClientsLimited: false })).toEqual({
      cid: "7",
      channel_maxclients: -1,
      channel_flag_maxclients_unlimited: true,
    });
    // The number of an unlimited channel does not matter.
    expect(editArgs("7", initial, { ...initial, maxClients: 99 })).toBeNull();
    expect(editArgs("7", initial, { ...initial, familyMode: "inherit" })).toEqual({
      cid: "7",
      channel_flag_maxfamilyclients_inherited: true,
    });
    const inherit = { ...initial, familyMode: "inherit" as const };
    expect(editArgs("7", inherit, { ...inherit, familyMode: "unlimited" })).toEqual({
      cid: "7",
      channel_flag_maxfamilyclients_unlimited: true,
      channel_flag_maxfamilyclients_inherited: false,
    });
  });

  it("type changes send both flags", () => {
    expect(editArgs("7", initial, { ...initial, type: "permanent" })).toEqual({
      cid: "7",
      channel_flag_permanent: true,
      channel_flag_semi_permanent: false,
    });
    expect(editArgs("7", initial, { ...initial, type: "temporary", deleteDelay: 30 })).toEqual({
      cid: "7",
      channel_flag_permanent: false,
      channel_flag_semi_permanent: false,
      channel_delete_delay: 30,
    });
  });

  it("the delete delay is only sent for temporary channels", () => {
    expect(editArgs("7", initial, { ...initial, deleteDelay: 30 })).toBeNull();
  });

  it("codec, quality, talk power, order, phonetic name and default", () => {
    expect(
      editArgs("7", initial, {
        ...initial,
        codec: 5,
        quality: 9,
        neededTalkPower: 2,
        order: "0",
        namePhonetic: "p",
        isDefault: true,
        type: "permanent",
      }),
    ).toEqual({
      cid: "7",
      channel_name_phonetic: "p",
      channel_codec: 5,
      channel_codec_quality: 9,
      channel_flag_permanent: true,
      channel_flag_semi_permanent: false,
      channel_flag_default: true,
      channel_needed_talk_power: 2,
      channel_order: "0",
    });
  });

  it("never sends a legacy codec back", () => {
    const speex = formFromChannel(channel({ codec: 2 }), "");
    expect(editArgs("7", speex, { ...speex, quality: 3 })).toEqual({
      cid: "7",
      channel_codec_quality: 3,
    });
  });
});

describe("iconChange", () => {
  const v = newChannelForm("semi", "0");
  it("set, clear or nothing", () => {
    expect(iconChange(v.iconId, 5)).toEqual({ kind: "set", iconId: 5 });
    expect(iconChange(5, 0)).toEqual({ kind: "clear" });
    expect(iconChange(5, 5)).toBeNull();
  });
});

describe("channelFormRules", () => {
  const errors = (v: ChannelFormValues, ctx = {}) =>
    checkAll(
      channelFormRules(
        { parentType: null, editing: false, hadPassword: false, maxDeleteDelay: -1, ...ctx },
        MSG,
      ),
      v,
    );
  const base = { ...newChannelForm("semi", "0"), name: "ok" };

  it("needs a name", () => {
    expect(errors({ ...base, name: " " }).name).toBeTruthy();
    expect(errors({ ...base, name: "x".repeat(41) }).name).toBeTruthy();
    expect(errors(base)).toEqual({});
  });

  it("needs a password when protection is turned on", () => {
    expect(errors({ ...base, hasPassword: true }).password).toBe("chm.errPasswordRequired");
    // Editing a protected channel: blank keeps the old one.
    expect(errors({ ...base, hasPassword: true }, { editing: true, hadPassword: true })).toEqual(
      {},
    );
  });

  it("a default channel is permanent and has no password", () => {
    expect(errors({ ...base, isDefault: true }).type).toBe("chm.errDefaultPermanent");
    expect(
      errors({ ...base, isDefault: true, type: "permanent", hasPassword: true, password: "x" })
        .hasPassword,
    ).toBe("chm.errDefaultPassword");
  });

  it("a subchannel cannot outlive its parent", () => {
    expect(errors({ ...base, type: "permanent" }, { parentType: "semi" }).type).toBe(
      "chm.errParentType",
    );
    expect(errors({ ...base, type: "semi" }, { parentType: "temporary" }).type).toBe(
      "chm.errParentType",
    );
    expect(errors({ ...base, type: "semi" }, { parentType: "semi" })).toEqual({});
  });

  it("holds the description to the server's byte limits, not just its length", () => {
    expect(errors({ ...base, description: "汉".repeat(2730) })).toEqual({});
    expect(errors({ ...base, description: "汉".repeat(2731) }).description).toBe(
      "chm.errDescriptionSize",
    );
    // Spaces and newlines go out escaped, two bytes each.
    expect(errors({ ...base, description: "a\n".repeat(4000) }).description).toBe(
      "chm.errDescriptionSize",
    );
  });

  it("checks limits and the delete delay", () => {
    expect(errors({ ...base, maxClientsLimited: true, maxClients: -1 }).maxClients).toBeTruthy();
    expect(errors({ ...base, maxClients: -1 })).toEqual({});
    expect(
      errors({ ...base, familyMode: "limited", maxFamilyClients: -3 }).maxFamilyClients,
    ).toBeTruthy();
    expect(errors({ ...base, quality: 11 }).quality).toBeTruthy();
    expect(
      errors({ ...base, type: "temporary", deleteDelay: 100 }, { maxDeleteDelay: 60 }).deleteDelay,
    ).toBeTruthy();
    expect(errors({ ...base, deleteDelay: 100 }, { maxDeleteDelay: 60 })).toEqual({});
  });
});

describe("orderChoices", () => {
  const list = [
    channel({ id: "3", parentId: "1", order: "0", name: "A" }),
    channel({ id: "4", parentId: "1", order: "3", name: "B" }),
    channel({ id: "7", parentId: "1", order: "4", name: "Me" }),
    channel({ id: "9", parentId: "2", order: "0", name: "Other" }),
  ];
  it("lists the siblings in order, without the channel itself", () => {
    expect(orderChoices(list, "1", "7")).toEqual([
      { value: "0", name: null },
      { value: "3", name: "A" },
      { value: "4", name: "B" },
    ]);
    expect(orderChoices(list, "5", null)).toEqual([{ value: "0", name: null }]);
  });
});
