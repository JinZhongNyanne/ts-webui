/**
 * What a file card has to do about the channel's password before it can
 * download or preview (card-actions.ts drives it; kept pure to test).
 *
 * A password is only asked for when the channel has one and this page knows
 * none that works: a known one is left to the transfers store, which fills
 * it in and remembers a typed one the server accepts.
 */
export type PasswordPlan =
  /** Go ahead; `password` undefined means "whatever is known for the channel". */
  | { readonly kind: "use"; readonly password?: string }
  /** Ask the user for it first. */
  | { readonly kind: "ask" }
  /** The channel the link names is not on this server (any more). */
  | { readonly kind: "gone" };

export function passwordPlan(
  channel: { flags: { password: boolean } } | undefined,
  known: string,
): PasswordPlan {
  if (!channel) return { kind: "gone" };
  if (!channel.flags.password || known) return { kind: "use" };
  return { kind: "ask" };
}
