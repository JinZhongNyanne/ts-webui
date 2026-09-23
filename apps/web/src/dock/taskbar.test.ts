import { describe, expect, it } from "vitest";
import { taskbarAction, taskbarButtons, type TaskbarButton } from "./taskbar";
import { NO_WINDOWS, setMinimized } from "./windowState";
import { WINDOW_META } from "./windowMeta";

const PANELS = [
  { id: "tree", title: "Channels" },
  { id: "chat:server", title: "Server chat" },
  { id: "info", title: "Info" },
];

describe("taskbarButtons", () => {
  it("gives one button per open window, in layout order", () => {
    expect(taskbarButtons(PANELS, null, NO_WINDOWS).map((b) => b.panelId)).toEqual([
      "tree",
      "chat:server",
      "info",
    ]);
  });

  it("shows nothing when no window is open", () => {
    expect(taskbarButtons([], null, NO_WINDOWS)).toEqual([]);
  });

  it("carries each window's own title", () => {
    const chat = taskbarButtons(PANELS, null, NO_WINDOWS)[1]!;
    expect(chat.title).toBe("Server chat");
  });

  it("gives a conversation the chat icon and a static window its own", () => {
    const [tree, chat] = taskbarButtons(PANELS, null, NO_WINDOWS);
    expect(tree!.icon).toBe(WINDOW_META.tree.icon);
    expect(chat!.icon).toBe(WINDOW_META.chat.icon);
  });

  it("marks the active window, and only that one", () => {
    const buttons = taskbarButtons(PANELS, "info", NO_WINDOWS);
    expect(buttons.filter((b) => b.active).map((b) => b.panelId)).toEqual(["info"]);
  });

  it("keeps a minimised window's button and marks it", () => {
    const states = setMinimized(NO_WINDOWS, "tree", true);
    const buttons = taskbarButtons(PANELS, null, states);
    expect(buttons.map((b) => b.panelId)).toContain("tree");
    expect(buttons.find((b) => b.panelId === "tree")!.minimized).toBe(true);
    expect(buttons.find((b) => b.panelId === "info")!.minimized).toBe(false);
  });

  it("does not call a minimised window active, even if dockview still does", () => {
    // dockview keeps its active panel while we hide the window; the taskbar
    // must not show a hidden window as the one in front.
    const states = setMinimized(NO_WINDOWS, "tree", true);
    const buttons = taskbarButtons(PANELS, "tree", states);
    expect(buttons.find((b) => b.panelId === "tree")!.active).toBe(false);
  });
});

describe("taskbarAction", () => {
  const button = (over: Partial<TaskbarButton>): TaskbarButton => ({
    panelId: "tree",
    title: "Channels",
    icon: "☰",
    active: false,
    minimized: false,
    ...over,
  });

  it("raises a window that is behind another", () => {
    expect(taskbarAction(button({ active: false }))).toBe("raise");
  });

  it("raises a minimised window", () => {
    expect(taskbarAction(button({ minimized: true }))).toBe("raise");
  });

  it("minimises the window that is already in front", () => {
    expect(taskbarAction(button({ active: true }))).toBe("minimize");
  });
});
