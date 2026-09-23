import { t, type MessageKey } from "../i18n";
import { IdentityError, type IdentityErrorCode } from "./formats";

const KEYS: Record<IdentityErrorCode, MessageKey> = {
  empty: "identity.errEmpty",
  unrecognized: "identity.errUnrecognized",
  badBase64: "identity.errBadBase64",
  badKey: "identity.errBadKey",
  noPrivateKey: "identity.errNoPrivateKey",
  keyMismatch: "identity.errKeyMismatch",
  badCounter: "identity.errBadCounter",
};

/** A translated, user-facing reason for an import/export failure. */
export function identityErrorText(err: unknown): string {
  if (err instanceof IdentityError) return t(KEYS[err.code]);
  return t("identity.errUnrecognized");
}
