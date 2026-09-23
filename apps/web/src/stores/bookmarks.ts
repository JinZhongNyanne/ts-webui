import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import {
  BOOKMARKS_KEY,
  clearRecent,
  forgetIdentity,
  groupBookmarks,
  groupNames,
  parseBookmarks,
  recordRecent,
  removeBookmark,
  upsertBookmark,
  type Bookmark,
  type BookmarkBook,
  type BookmarkDraft,
  type ServerTarget,
} from "../bookmarks/book";
import { createVault, indexedDbKeySource, type Sealed } from "../bookmarks/vault";
import { newId } from "../identity/book";
import type { BookmarkForm } from "../bookmarks/form";

export type { BookmarkForm };

/**
 * Bookmarks and recent connections (see bookmarks/book.ts), with passwords
 * sealed by the vault before anything is written to localStorage.
 */
export const useBookmarksStore = defineStore("bookmarks", () => {
  const book = shallowRef<BookmarkBook>(parseBookmarks(localStorage.getItem(BOOKMARKS_KEY)));
  const vault = createVault(indexedDbKeySource());

  // Edits write the whole book back; follow other tabs' writes so ours do not
  // silently drop the bookmarks they added.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === BOOKMARKS_KEY || e.key === null) {
        book.value = parseBookmarks(localStorage.getItem(BOOKMARKS_KEY));
      }
    });
  }

  const bookmarks = computed(() => book.value.bookmarks);
  const recent = computed(() => book.value.recent);
  const groups = computed(() => groupBookmarks(book.value.bookmarks));
  const folders = computed(() => groupNames(book.value));

  function commit(next: BookmarkBook): void {
    if (next === book.value) return;
    book.value = next;
    try {
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(next));
    } catch {
      // Quota or private mode: in-memory only for this page.
    }
  }

  async function sealOrNull(plain: string): Promise<Sealed | null> {
    return plain ? vault.seal(plain) : null;
  }

  /** Saves a bookmark; throws when a password was given but cannot be encrypted. */
  async function save(form: BookmarkForm): Promise<string> {
    const draft: BookmarkDraft = {
      id: form.id,
      label: form.label,
      group: form.group,
      host: form.host,
      port: form.port,
      nickname: form.nickname,
      identityId: form.identityId,
      defaultChannel: form.defaultChannel,
      musicBot: form.musicBot,
      serverPassword: await sealOrNull(form.serverPassword),
      channelPassword: await sealOrNull(form.channelPassword),
    };
    const r = upsertBookmark(book.value, draft, newId);
    commit(r.book);
    return r.id;
  }

  /**
   * A bookmark in clear text. A password that no longer opens (the vault key
   * was cleared with site data) comes back empty with `lostPasswords` set, so
   * the UI can ask for it instead of failing.
   */
  async function unlock(b: Bookmark): Promise<{ form: BookmarkForm; lostPasswords: boolean }> {
    let lost = false;
    const open = async (s: Sealed | null): Promise<string> => {
      if (!s) return "";
      try {
        return await vault.open(s);
      } catch {
        lost = true;
        return "";
      }
    };
    const form: BookmarkForm = {
      id: b.id,
      label: b.label,
      group: b.group,
      host: b.host,
      port: b.port,
      nickname: b.nickname,
      identityId: b.identityId,
      defaultChannel: b.defaultChannel,
      musicBot: b.musicBot,
      serverPassword: await open(b.serverPassword),
      channelPassword: await open(b.channelPassword),
    };
    return { form, lostPasswords: lost };
  }

  function remove(id: string): void {
    commit(removeBookmark(book.value, id));
  }

  function noteConnected(t: ServerTarget): void {
    commit(recordRecent(book.value, t));
  }

  function clearRecentList(): void {
    commit(clearRecent(book.value));
  }

  function dropIdentity(identityId: string): void {
    commit(forgetIdentity(book.value, identityId));
  }

  return {
    bookmarks,
    recent,
    groups,
    folders,
    save,
    unlock,
    remove,
    noteConnected,
    clearRecent: clearRecentList,
    dropIdentity,
  };
});
