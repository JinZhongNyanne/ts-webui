/**
 * `await askChannelPassword(name)`: the password of a channel a shared file
 * is in, or null when the user cancels. Rendered once by
 * `components/chat/FilePasswordHost.vue`; a second request while one is open
 * cancels the first (the user clicked another file).
 */
import { shallowRef } from "vue";

export interface PasswordRequest {
  readonly channel: string;
  readonly resolve: (password: string | null) => void;
}

export const passwordRequest = shallowRef<PasswordRequest | null>(null);

export function askChannelPassword(channel: string): Promise<string | null> {
  passwordRequest.value?.resolve(null);
  return new Promise((resolve) => {
    passwordRequest.value = { channel, resolve };
  });
}

/** Answers the open request (null = cancelled) and closes it. */
export function answerPassword(password: string | null): void {
  const req = passwordRequest.value;
  passwordRequest.value = null;
  req?.resolve(password);
}
