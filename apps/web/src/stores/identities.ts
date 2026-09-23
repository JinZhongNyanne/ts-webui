import { defineStore } from "pinia";
import { computed, shallowRef } from "vue";
import { t } from "../i18n";
import {
  activeIdentity,
  addIdentity,
  BOOK_KEY,
  adoptHubIdentity,
  generateKey,
  keyOf,
  loadBook,
  makeIdentity,
  parseImport,
  removeIdentity,
  replaceKey,
  saveBook,
  setActive,
  updateIdentity,
  type IdentityBook,
  type StoredIdentity,
} from "../identity/book";
import type { IdentityKey } from "../identity/formats";

/**
 * The identities kept in this browser (see identity/book.ts). Every edit
 * replaces the whole book and writes it back, so the list survives reloads and
 * the old single `jinz.ts.identity` is migrated on first load.
 */
export const useIdentitiesStore = defineStore("identities", () => {
  const book = shallowRef<IdentityBook>(loadBook(localStorage, t("identity.defaultName")));
  const items = computed(() => book.value.items);
  const active = computed(() => activeIdentity(book.value));

  // Every edit writes the whole book back, so a copy another tab has since
  // changed would be overwritten, and an imported private key that was never
  // exported would be gone for good. Take the other tab's copy as it lands.
  if (typeof window !== "undefined") {
    window.addEventListener("storage", (e) => {
      if (e.key === BOOK_KEY || e.key === null) {
        book.value = loadBook(localStorage, t("identity.defaultName"));
      }
    });
  }

  function commit(next: IdentityBook): void {
    if (next === book.value) return;
    book.value = next;
    try {
      saveBook(localStorage, next);
    } catch {
      // Quota or private mode: keep working in memory for this page.
    }
  }

  function select(id: string): void {
    commit(setActive(book.value, id));
  }

  function create(name: string, nickname = ""): StoredIdentity {
    const item = makeIdentity(generateKey(), { name, nickname });
    const r = addIdentity(book.value, item);
    commit(setActive(r.book, r.id));
    return item;
  }

  /**
   * The identity `connect` should send, creating the first one on demand so a
   * brand-new visitor gets a stable UID from the very first connection.
   */
  function ensureActive(): StoredIdentity {
    return active.value ?? create(t("identity.defaultName"));
  }

  /** Imports every identity found in the text; returns how many were new vs. already known. */
  function importText(text: string): { added: number; merged: number; lastId: string } {
    let next = book.value;
    let added = 0;
    let merged = 0;
    let lastId = "";
    for (const c of parseImport(text)) {
      const item = makeIdentity(c.key, {
        name: c.name || t("identity.importedName"),
        nickname: c.nickname,
      });
      const r = addIdentity(next, item);
      next = r.book;
      lastId = r.id;
      if (r.existed) merged++;
      else added++;
    }
    commit(next);
    return { added, merged, lastId };
  }

  function update(id: string, patch: { name?: string; nickname?: string }): void {
    commit(updateIdentity(book.value, id, patch));
  }

  function remove(id: string): void {
    commit(removeIdentity(book.value, id));
  }

  function setKey(id: string, key: IdentityKey): void {
    commit(replaceKey(book.value, id, key));
  }

  /** Called with `connected.identity`; keeps any counter the hub raised. */
  function adoptFromHub(hubKey: string): void {
    commit(adoptHubIdentity(book.value, hubKey, t("identity.defaultName")));
  }

  function byId(id: string | null): StoredIdentity | null {
    return id ? (book.value.items.find((i) => i.id === id) ?? null) : null;
  }

  return {
    items,
    active,
    select,
    create,
    ensureActive,
    importText,
    update,
    remove,
    setKey,
    adoptFromHub,
    byId,
    keyOf,
  };
});
