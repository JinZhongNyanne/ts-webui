import type { Session } from "./Session.js";

/**
 * What an HTTP route needs from the session registry to authorise a request.
 *
 * Calls the page makes with `fetch()` carry the session id in an
 * `x-session-id` header and go through `getConnected`. Anything an `<img>` or
 * `<audio>` tag loads cannot set a header, so its URL carries a short-lived,
 * read-only asset token instead, resolved through `getConnectedByAssetToken`.
 * Both return the session only while it is connected to a TeamSpeak server.
 *
 * Routes depend on this slice rather than on `SessionRegistry` so they can be
 * tested with a two-line fake.
 */
export interface AssetRegistry {
  getConnected(id: string | undefined): Session | undefined;
  getConnectedByAssetToken(token: string | undefined): Session | undefined;
}

/** The session id a `fetch()` call carries, or undefined when absent or malformed. */
export function sessionIdFromHeaders(headers: {
  "x-session-id"?: string | string[] | undefined;
}): string | undefined {
  const value = headers["x-session-id"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
