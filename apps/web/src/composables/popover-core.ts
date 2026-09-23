/**
 * Framework-free half of `usePopover`: the "only one popover at a time"
 * registry and the decisions about which events dismiss an open popover.
 * Kept free of Vue and DOM imports so it can be unit-tested on plain node.
 */

export type PopoverCloser = () => void;

/** Answers whether an event target lies inside the popover's root element. */
export type ContainsTarget = (target: unknown) => boolean;

export interface PopoverRegistry {
  /** Registers `close` as the active popover, closing any other one first. */
  readonly activate: (close: PopoverCloser) => void;
  /** Forgets `close`; safe to call when it was never registered. */
  readonly release: (close: PopoverCloser) => void;
  readonly isActive: (close: PopoverCloser) => boolean;
  readonly size: () => number;
}

export const DISMISS_KEY = "Escape";

export function createPopoverRegistry(): PopoverRegistry {
  const active = new Set<PopoverCloser>();

  const activate = (close: PopoverCloser): void => {
    // Snapshot first: closing another popover releases it, which mutates the set.
    const others = [...active].filter((other) => other !== close);
    for (const other of others) {
      active.delete(other);
      other();
    }
    active.add(close);
  };

  const release = (close: PopoverCloser): void => {
    active.delete(close);
  };

  return {
    activate,
    release,
    isActive: (close) => active.has(close),
    size: () => active.size,
  };
}

/** A pointer press dismisses the popover only when it lands outside it. */
export function pointerDismisses(target: unknown, contains: ContainsTarget): boolean {
  return !contains(target);
}

/**
 * Joins several "is the target inside me?" checks into one.
 *
 * A popover teleported to `<body>` so it can escape its dock window is no
 * longer in its trigger's subtree, so a containment test against the trigger
 * alone would call the popover's own buttons "outside" and dismiss it on the
 * first press. "Inside" therefore means inside any of the boxes the popover
 * owns: its trigger and its teleported panel.
 */
export function containsAny(checks: readonly ContainsTarget[]): ContainsTarget {
  return (target) => checks.some((contains) => contains(target));
}

/** Only Escape dismisses via the keyboard. */
export function keyDismisses(key: string): boolean {
  return key === DISMISS_KEY;
}
