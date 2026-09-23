/**
 * Identities and bookmarks live in localStorage and each tab writes its whole
 * copy back on every change. Without following other tabs' writes, a tab that
 * was open before another one created an identity would erase that identity
 * (a private key nobody exported) on its next write, e.g. when it connects.
 */
import assert from "node:assert/strict";

export const title = "multi-tab: a second tab's new identity survives the first tab's writes";

const BOOK_KEY = "jinz.ts.identities";

function identityNames(page) {
  return page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? "{}").items ?? []).map((i) => i.name),
    BOOK_KEY,
  );
}

async function createIdentity(page, name) {
  await page.getByRole("button", { name: /Manage identities|管理身份/ }).click();
  await page.getByPlaceholder(/Name for a new identity|新身份/).fill(name);
  await page.getByRole("button", { name: /^(New identity|新建身份)$/ }).click();
  await page.waitForFunction(
    ([key, n]) => (localStorage.getItem(key) ?? "").includes(n),
    [BOOK_KEY, name],
  );
}

export default async function multiTab(rig) {
  // Tab 1 connects (creating and saving its identity) and stays open.
  const alice = await rig.connect("alice", { channel: "a" });
  const tab2 = await alice.context.newPage();
  await tab2.goto(rig.webUrl, { waitUntil: "domcontentloaded" });

  await createIdentity(tab2, "from-tab-2");

  // Tab 1 (loaded before tab 2's change) now writes its own copy of the
  // book: it creates an identity of its own from the connect dialog.
  await alice.page.getByRole("button", { name: /^(Disconnect|断开)$/ }).click();
  await createIdentity(alice.page, "from-tab-1");

  const names = await identityNames(alice.page);
  assert.ok(names.includes("from-tab-1"), `tab 1's identity was saved (${names.join(", ")})`);
  assert.ok(names.includes("from-tab-2"), `tab 2's identity is still there (${names.join(", ")})`);
}
