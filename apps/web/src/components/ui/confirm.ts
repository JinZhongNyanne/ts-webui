/**
 * `await confirmDialog({...})` — the styled, translated stand-in for
 * `window.confirm`. Resolves `true` on confirm, `false` on cancel, Escape or
 * the backdrop.
 *
 * The dialog itself is rendered once, by `ConfirmHost.vue` in `App.vue`; this
 * module only holds the queue. Asking twice before the first is answered
 * shows the prompts one after another instead of stacking two modals.
 */
import { computed, shallowRef, type ComputedRef } from "vue";

export interface ConfirmOptions {
  readonly title: string;
  /** The question in full: what will happen, to whom. */
  readonly message?: string;
  /** Defaults to a generic "OK"; name the action instead where you can ("Kick"). */
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Red confirm button, for things that cannot be undone. */
  readonly danger?: boolean;
}

export interface PendingConfirm extends ConfirmOptions {
  readonly id: number;
}

interface Entry {
  readonly prompt: PendingConfirm;
  readonly resolve: (ok: boolean) => void;
}

export interface ConfirmQueue {
  readonly ask: (options: ConfirmOptions) => Promise<boolean>;
  /** Answers the prompt with this id; a stale id (already answered) is ignored. */
  readonly answer: (id: number, ok: boolean) => void;
  /** The prompt to show now, or null. */
  readonly current: ComputedRef<PendingConfirm | null>;
  /** Cancels everything waiting, e.g. when the session drops under a prompt. */
  readonly cancelAll: () => void;
}

export function createConfirmQueue(): ConfirmQueue {
  const queue = shallowRef<readonly Entry[]>([]);
  let nextId = 1;

  const ask = (options: ConfirmOptions): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const prompt: PendingConfirm = { ...options, id: nextId++ };
      queue.value = [...queue.value, { prompt, resolve }];
    });

  const answer = (id: number, ok: boolean): void => {
    const entry = queue.value.find((e) => e.prompt.id === id);
    if (!entry) return;
    queue.value = queue.value.filter((e) => e !== entry);
    entry.resolve(ok);
  };

  const cancelAll = (): void => {
    const waiting = queue.value;
    queue.value = [];
    for (const e of waiting) e.resolve(false);
  };

  return {
    ask,
    answer,
    cancelAll,
    current: computed(() => queue.value[0]?.prompt ?? null),
  };
}

/** The app-wide queue that `ConfirmHost.vue` renders. */
export const confirmQueue = createConfirmQueue();

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return confirmQueue.ask(options);
}
