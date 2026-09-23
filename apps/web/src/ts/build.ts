/**
 * Build identity, so a tab left open across a hub update can tell that the
 * page it runs is older than the hub it talks to.
 *
 * Both sides carry the same commit id: the Dockerfile bakes it into the hub
 * (`BUILD_ID`) and into this bundle (`VITE_BUILD_ID`). A dev server or an
 * image built without it reports "", which never counts as a mismatch.
 */

/** The commit this page was built from; "" when unknown. */
export const PAGE_BUILD: string = (import.meta.env.VITE_BUILD_ID ?? "").trim();

/** True when both builds are known and differ. */
export function pageBuildIsStale(
  pageBuild: string | undefined,
  hubBuild: string | undefined,
): boolean {
  const page = pageBuild?.trim() ?? "";
  const hub = hubBuild?.trim() ?? "";
  return page !== "" && hub !== "" && page !== hub;
}
