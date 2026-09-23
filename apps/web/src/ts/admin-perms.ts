/**
 * When to offer each M2 admin tool. Two kinds of permission are involved, and
 * a live TS3 server settles which is which:
 *
 *  - Flags `notifyclientneededpermissions` carries (a Server Admin's set had
 *    b_client_complain_list, b_client_offline_textmessage_send,
 *    b_virtualserver_client_dblist, b_virtualserver_modify_temporary_passwords):
 *    that set lists what we are granted, so once loaded a missing flag is a no
 *    (`!loaded || has`).
 *  - Everything else (i_client_complain_power, the complaint delete flags, the
 *    client db search / edit / delete flags, _temporary_passwords_own) only
 *    arrives through the hub's `permget`, which needs
 *    b_client_permissionoverview_own. Unknown means "offer it and let the
 *    server's refusal name the permission"; known 0 hides it (`mayUse`).
 *
 * The windows themselves are gated on the notify flags, so a plain user is
 * not offered a window full of actions they would all be refused.
 */
export const PERM = {
  complainPower: "i_client_complain_power",
  complainList: "b_client_complain_list",
  complainDelete: "b_client_complain_delete",
  complainDeleteOwn: "b_client_complain_delete_own",
  offlineSend: "b_client_offline_textmessage_send",
  dbList: "b_virtualserver_client_dblist",
  dbSearch: "b_virtualserver_client_dbsearch",
  dbInfo: "b_virtualserver_client_dbinfo",
  dbModify: "b_client_modify_dbproperties",
  dbDelete: "b_client_delete_dbproperties",
  tempPasswords: "b_virtualserver_modify_temporary_passwords",
  tempPasswordsOwn: "b_virtualserver_modify_temporary_passwords_own",
} as const;

/** The parts of the perms store this needs. */
export interface PermSource {
  readonly loaded: boolean;
  has(name: string): boolean;
  mayUse(name: string): boolean;
}

export function adminGates(p: PermSource) {
  const flag = (name: string) => !p.loaded || p.has(name);
  return {
    complain: () => p.mayUse(PERM.complainPower),
    complaintList: () => flag(PERM.complainList),
    /** Anyone's complaint, or one we filed ourselves. */
    deleteComplaint: (fromDbId: string, myDbId: string | undefined) =>
      p.mayUse(PERM.complainDelete) || (fromDbId === myDbId && p.mayUse(PERM.complainDeleteOwn)),
    deleteAllComplaints: () => p.mayUse(PERM.complainDelete),
    sendOffline: () => flag(PERM.offlineSend),
    clientDb: () => flag(PERM.dbList),
    /** Search, and the per-hit details it needs. */
    searchDb: () => p.mayUse(PERM.dbSearch) && p.mayUse(PERM.dbInfo),
    editDb: () => p.mayUse(PERM.dbModify),
    deleteDb: () => p.mayUse(PERM.dbDelete),
    /**
     * `_own` alone also opens the window, but only when we know it is granted:
     * unknown would offer the window to every guest.
     */
    tempPasswords: () => !p.loaded || p.has(PERM.tempPasswords) || p.has(PERM.tempPasswordsOwn),
    deleteTempPassword: (creatorUid: string, myUid: string | undefined) =>
      flag(PERM.tempPasswords) || (creatorUid === myUid && p.mayUse(PERM.tempPasswordsOwn)),
  };
}

export type AdminGates = ReturnType<typeof adminGates>;
