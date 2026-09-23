/**
 * Promise API over the hub's allow-listed TeamSpeak commands (`ts.cmd`):
 *
 *   const groups = await tsCommand("servergrouplist", {});
 *   await tsCommand("clientedit", { clid, client_is_talker: true });
 *
 * Each call gets a short id the hub echoes in its `ts.cmdResult`. A call
 * settles exactly once: with the result rows, or with a TsCommandError whose
 * message is already translated (the hub sends text codes, see text-code.ts).
 * Arguments are checked against the same zod schema the hub uses, so a bad
 * call fails here with the reason instead of as an anonymous "bad_args".
 */
import {
  TS_CMD_HUB_CODES,
  TsCmdRequestSchema,
  type ClientMessage,
  type ServerMessage,
  type TsCmdArgs,
  type TsCmdName,
  type TsCmdRow,
} from "@jinz/protocol";
import { translateCode } from "../i18n";
import type { HubState } from "./connection";
import { hub } from "./hub";

/** The hub gives TeamSpeak 8 s, so a slow server still gets a proper answer through to us. */
export const TS_COMMAND_TIMEOUT_MS = 10_000;

export class TsCommandError extends Error {
  constructor(
    /** TeamSpeak error id ("2568") or a hub code (TS_CMD_HUB_CODES). */
    readonly code: string,
    message: string,
    /** For "insufficient permissions": the permission the server checked. */
    readonly failedPermission?: string,
  ) {
    super(message);
    this.name = "TsCommandError";
  }
}

/** The parts of HubConnection this needs (an interface so tests can fake the hub). */
export interface CommandTransport {
  readonly state: HubState;
  send(msg: ClientMessage): void;
  onMessage(fn: (msg: ServerMessage) => void): () => void;
  onState(fn: (state: HubState) => void): () => void;
}

interface Pending {
  resolve: (rows: TsCmdRow[]) => void;
  reject: (err: TsCommandError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TsCommandClient {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(
    private readonly transport: CommandTransport,
    private readonly timeoutMs = TS_COMMAND_TIMEOUT_MS,
  ) {
    transport.onMessage((msg) => this.onMessage(msg));
    // Nothing will ever answer a request sent on a socket that went away.
    transport.onState((state) => {
      if (state === "closed") this.failAll(TS_CMD_HUB_CODES.notConnected, "tsErr.notConnected");
    });
  }

  run<C extends TsCmdName>(cmd: C, args: TsCmdArgs<C>): Promise<TsCmdRow[]> {
    const id = `c${(this.seq = (this.seq + 1) % 1_000_000_000)}`;
    const checked = TsCmdRequestSchema.safeParse({ type: "ts.cmd", id, cmd, args });
    if (!checked.success) {
      const detail = checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
      return Promise.reject(
        new TsCommandError(
          TS_CMD_HUB_CODES.badArgs,
          `${translateCode("tsErr.badArgs")} (${detail.join("; ")})`,
        ),
      );
    }
    if (this.transport.state !== "open") {
      return Promise.reject(this.error(TS_CMD_HUB_CODES.notConnected, "tsErr.notConnected"));
    }
    return new Promise<TsCmdRow[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(this.error(TS_CMD_HUB_CODES.timeout, "tsErr.timeout"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.transport.send(checked.data);
    });
  }

  /** Requests still waiting for an answer (for tests and diagnostics). */
  get inFlight(): number {
    return this.pending.size;
  }

  private onMessage(msg: ServerMessage): void {
    if (msg.type === "disconnected") {
      this.failAll(TS_CMD_HUB_CODES.notConnected, "tsErr.notConnected");
      return;
    }
    if (msg.type !== "ts.cmdResult") return;
    const entry = this.pending.get(msg.id);
    // Late answers (after a timeout) have nobody left to tell.
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg.rows);
    else entry.reject(this.error(msg.code, msg.message, msg.failedPermission));
  }

  private failAll(code: string, message: string): void {
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(this.error(code, message));
    }
  }

  private error(code: string, textCode: string, failedPermission?: string): TsCommandError {
    return new TsCommandError(code, translateCode(textCode), failedPermission);
  }
}

let shared: TsCommandClient | null = null;

/** Runs an allow-listed TeamSpeak command on the current connection. */
export function tsCommand<C extends TsCmdName>(cmd: C, args: TsCmdArgs<C>): Promise<TsCmdRow[]> {
  shared ??= new TsCommandClient(hub);
  return shared.run(cmd, args);
}
