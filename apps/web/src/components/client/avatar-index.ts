/**
 * UID → avatar hash of every client we see, built once per change of the
 * client list and shared by every `ClientAvatar` that only knows a UID (one
 * per chat message: scanning the client list from each of them would repeat
 * the same walk thousands of times on every client update).
 */
import { computed, type ComputedRef } from "vue";
import { useTsStore } from "../../stores/ts";

let index: ComputedRef<Map<string, string>> | null = null;

export function avatarByUid(): ComputedRef<Map<string, string>> {
  if (index) return index;
  const ts = useTsStore();
  index = computed(() => {
    const map = new Map<string, string>();
    for (const c of ts.clients.values()) if (c.avatar) map.set(c.uid, c.avatar);
    return map;
  });
  return index;
}
