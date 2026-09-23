/**
 * Which file browser actions to offer. Each maps to the client's own power
 * (`notifyclientneededpermissions` reports the ones granted; a live server
 * leaves out those a guest lacks); the server compares it with the channel's
 * i_ft_needed_* value and, when it falls short, names that needed permission
 * in its refusal. So, as for the M2 menus: unknown means offer, a known 0
 * means hide (perms.mayUse).
 */

export const FT_POWERS = {
  browse: "i_ft_file_browse_power",
  upload: "i_ft_file_upload_power",
  download: "i_ft_file_download_power",
  rename: "i_ft_file_rename_power",
  delete: "i_ft_file_delete_power",
  createDir: "i_ft_directory_create_power",
} as const;

export type FileAction = keyof typeof FT_POWERS;

export function fileActions(perms: { mayUse(name: string): boolean }): Record<FileAction, boolean> {
  const out = {} as Record<FileAction, boolean>;
  for (const [action, power] of Object.entries(FT_POWERS)) {
    out[action as FileAction] = perms.mayUse(power);
  }
  return out;
}
