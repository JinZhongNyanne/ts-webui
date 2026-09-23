import { iconForPanel } from "./windowMeta";
import { isMinimized, type WindowStates } from "./windowState";

/**
 * The taskbar, as data: one button per open window, and what a click on one
 * means. `Taskbar.vue` renders this and nothing else, so the behaviour is
 * testable without a DOM.
 */

/** One panel in the layout, reduced to what the taskbar shows. */
export interface PanelSnapshot {
  readonly id: string;
  readonly title: string;
}

export interface TaskbarButton {
  readonly panelId: string;
  readonly title: string;
  readonly icon: string;
  /** The window in front. A minimised window is never in front. */
  readonly active: boolean;
  readonly minimized: boolean;
}

export type TaskbarAction = "raise" | "minimize";

/** A button per open window, in the order the layout holds them. */
export function taskbarButtons(
  panels: readonly PanelSnapshot[],
  activeId: string | null,
  states: WindowStates,
): readonly TaskbarButton[] {
  return panels.map((panel) => {
    const minimized = isMinimized(states, panel.id);
    return {
      panelId: panel.id,
      title: panel.title,
      icon: iconForPanel(panel.id),
      // dockview keeps its active panel while the window is hidden, so a
      // minimised window would otherwise show as the one in front.
      active: !minimized && panel.id === activeId,
      minimized,
    };
  });
}

/** Windows' rule: clicking the window you are already in puts it away. */
export function taskbarAction(button: TaskbarButton): TaskbarAction {
  return button.active ? "minimize" : "raise";
}
