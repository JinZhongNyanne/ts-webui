/** The admin gates (ts/admin-perms.ts) over the live perms store, plus who we are. */
import { useTsStore } from "../../stores/ts";
import { usePermsStore } from "../../stores/perms";
import { adminGates } from "../../ts/admin-perms";

export function useAdminGates() {
  const perms = usePermsStore();
  const ts = useTsStore();
  const gates = adminGates({
    get loaded() {
      return perms.loaded;
    },
    has: (n) => perms.has(n),
    mayUse: (n) => perms.mayUse(n),
  });
  return {
    ...gates,
    myDbId: () => ts.selfClient?.databaseId,
    myUid: () => ts.selfClient?.uid,
  };
}
