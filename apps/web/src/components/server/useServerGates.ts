/** The M4 server gates (server-gates.ts) over the live perms store. */
import { usePermsStore } from "../../stores/perms";
import { serverGates } from "./server-gates";

export function useServerGates() {
  const perms = usePermsStore();
  return serverGates({
    get loaded() {
      return perms.loaded;
    },
    has: (n) => perms.has(n),
    mayUse: (n) => perms.mayUse(n),
  });
}
