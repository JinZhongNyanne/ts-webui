/**
 * What the channel dialog's submit makes of the server's answer
 * (useChannelForm): which field a refusal belongs to, and which channel a
 * create produced, so its icon can be set in a second command.
 */
import type { ChannelFormValues } from "./channel-form";
import { TsCommandError } from "./commands";

/** TeamSpeak errors that are about one field. */
const FIELD_OF_ERROR: Readonly<Record<string, keyof ChannelFormValues>> = {
  "771": "name", // channel name in use
  "774": "type", // invalid flags
  "776": "type", // parent is not permanent enough
};

/** The field a command error is about; undefined for the form as a whole. */
export function fieldOfError(err: unknown): keyof ChannelFormValues | undefined {
  return err instanceof TsCommandError ? FIELD_OF_ERROR[err.code] : undefined;
}

interface Named {
  readonly id: string;
  readonly parentId: string;
  readonly name: string;
}

/**
 * The channel a `channelcreate` just made: named `name` under `parentId`, and
 * not one of the `before` ids. The server's notify (and so the channel)
 * arrives before the command's answer.
 */
export function createdChannel<C extends Named>(
  channels: Iterable<C>,
  parentId: string,
  name: string,
  before: ReadonlySet<string>,
): C | undefined {
  const wanted = name.trim();
  for (const c of channels) {
    if (c.parentId === parentId && c.name === wanted && !before.has(c.id)) return c;
  }
  return undefined;
}
