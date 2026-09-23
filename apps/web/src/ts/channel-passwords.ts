/**
 * The channel passwords this page knows to be right: one per channel, shared
 * by everything that needs one (joining again after a reconnect, the file
 * browser, file cards in chat, the transfers store).
 *
 * A password is only written once the server has accepted it: a move landed
 * us in the channel, a connect with a default channel password landed us in
 * a channel that has one, or a file listing, download link or upload went
 * through with it. A guess the server refused is never kept, so it cannot
 * shadow a right one or be tried again without asking.
 */
import { shallowRef, type Ref } from "vue";

interface Pending {
  /** The channel asked for; null for a connect's default channel (known once we land). */
  readonly cid: string | null;
  readonly password: string;
}

export interface ChannelPasswords {
  readonly known: Readonly<Ref<ReadonlyMap<string, string>>>;
  /** The known password of `cid`, "" when there is none. */
  get(cid: string): string;
  /** Records a password the server accepted for `cid` ("" changes nothing). */
  remember(cid: string, password: string): void;
  /** Drops a password the server no longer takes. */
  forget(cid: string): void;
  /** A move to `cid` was asked for; its password is kept once `arrived(cid)` says so. */
  expectMove(cid: string, password?: string): void;
  /** A connect with this default channel password was sent. */
  expectJoin(password?: string): void;
  /** We are in `cid` now (a move went through). */
  arrived(cid: string): void;
  /** The connect's first channel: `cid`, which may or may not want a password. */
  landed(cid: string, hasPassword: boolean): void;
  clear(): void;
}

export function createChannelPasswords(): ChannelPasswords {
  const known = shallowRef<ReadonlyMap<string, string>>(new Map());
  let pending: Pending | null = null;

  function remember(cid: string, password: string): void {
    if (!password || known.value.get(cid) === password) return;
    known.value = new Map([...known.value, [cid, password]]);
  }

  function forget(cid: string): void {
    if (!known.value.has(cid)) return;
    known.value = new Map([...known.value].filter(([id]) => id !== cid));
  }

  return {
    known,
    get: (cid) => known.value.get(cid) ?? "",
    remember,
    forget,
    expectMove(cid, password) {
      pending = password ? { cid, password } : null;
    },
    expectJoin(password) {
      pending = password ? { cid: null, password } : null;
    },
    arrived(cid) {
      if (pending?.cid !== cid) return;
      remember(cid, pending.password);
      pending = null;
    },
    landed(cid, hasPassword) {
      if (pending?.cid === null && hasPassword) remember(cid, pending.password);
      if (pending?.cid === null) pending = null;
    },
    clear() {
      known.value = new Map();
      pending = null;
    },
  };
}
