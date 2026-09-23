import { ref, type Ref } from "vue";
import type { AssetTokenGrant } from "@jinz/protocol";

/**
 * The short-lived token that asset URLs (icons, avatars, profile assets, TTS)
 * carry instead of the session id. The hub rotates it every few minutes and
 * keeps older ones valid until their own expiry, so a rotation must not
 * rebuild every `<img>` on the page: the token itself lives outside Vue's
 * reactivity, and only its presence is reactive.
 */
const NO_TOKEN: AssetTokenGrant = { token: "", expiresAt: 0 };

let current: AssetTokenGrant = NO_TOKEN;

/** True while a token is held; flips only on grant/clear, never on rotation. */
export const hasAssetToken: Ref<boolean> = ref(false);

export function setAssetToken(grant: AssetTokenGrant): void {
  current = { token: grant.token, expiresAt: grant.expiresAt };
  if (!hasAssetToken.value) hasAssetToken.value = true;
}

export function clearAssetToken(): void {
  current = NO_TOKEN;
  if (hasAssetToken.value) hasAssetToken.value = false;
}

/** The latest token, or "" when none is held. Plain getter: not tracked by Vue. */
export function assetToken(): string {
  return current.token;
}

/** Unix epoch milliseconds after which the latest token is refused; 0 when none. */
export function assetExpiresAt(): number {
  return current.expiresAt;
}
