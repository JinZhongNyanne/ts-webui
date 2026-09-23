/**
 * What to do with a server's host message on connect, per
 * `virtualserver_hostmessage_mode` as the TS3 client handles it:
 *
 * - 0 none: not shown at all (it is still listed in the server info panel).
 * - 1 log: a line in the chat/event log.
 * - 2 modal: a dialog the user has to dismiss.
 * - 3 modal + quit: the dialog, and the client disconnects. Servers use it as
 *   a "closed, go here instead" notice, so it applies even when the text is
 *   empty — the dialog then just says the server sent us away.
 *
 * Unknown modes are treated as 0: guessing "quit" would be worse than
 * showing nothing.
 */

export type HostMessageAction =
  | { kind: "none" }
  | { kind: "log"; text: string }
  | { kind: "modal"; text: string; disconnect: boolean };

export const HostMessageMode = { None: 0, Log: 1, Modal: 2, ModalQuit: 3 } as const;

export function hostMessageAction(server: {
  hostMessage: string;
  hostMessageMode: number;
}): HostMessageAction {
  const text = server.hostMessage.trim();
  switch (server.hostMessageMode) {
    case HostMessageMode.Log:
      return text ? { kind: "log", text } : { kind: "none" };
    case HostMessageMode.Modal:
      return text ? { kind: "modal", text, disconnect: false } : { kind: "none" };
    case HostMessageMode.ModalQuit:
      return { kind: "modal", text, disconnect: true };
    default:
      return { kind: "none" };
  }
}
