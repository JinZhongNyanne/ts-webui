import { describe, expect, it } from "vitest";
import { fileActions, FT_POWERS } from "./browser-perms";

/** A perms store stand-in: `values` known, the rest unknown (mayUse says yes). */
const perms = (values: Record<string, number>) => ({
  mayUse: (name: string) => !(name in values) || values[name]! > 0,
});

describe("fileActions", () => {
  it("offers everything while the powers are unknown", () =>
    expect(Object.values(fileActions(perms({})))).toEqual(Object.keys(FT_POWERS).map(() => true)));

  it("hides what a known power of 0 rules out", () =>
    expect(
      fileActions(perms({ i_ft_file_delete_power: 0, i_ft_directory_create_power: 0 })),
    ).toEqual({
      browse: true,
      upload: true,
      download: true,
      rename: true,
      delete: false,
      createDir: false,
    }));

  it("uses the client's own powers (the server names the channel's needed ones)", () =>
    expect(FT_POWERS).toEqual({
      browse: "i_ft_file_browse_power",
      upload: "i_ft_file_upload_power",
      download: "i_ft_file_download_power",
      rename: "i_ft_file_rename_power",
      delete: "i_ft_file_delete_power",
      createDir: "i_ft_directory_create_power",
    }));
});
