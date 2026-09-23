# Windows-style Desktop Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the web client's shell into a Windows-style desktop: a taskbar of open windows on top, fixed status bar below, a desktop of icons between them, and every panel a floating window with minimise, maximise and Aero Snap.

**Architecture:** dockview stays, but its grid is never used: it is left empty and its watermark slot renders the desktop, while every panel is added as a floating group in dockview's overlay layer above it. All the decision logic (placement, snap zones, window state, taskbar model) lives in pure modules under `apps/web/src/dock/`, unit-tested on the node environment; the Vue components and `App.vue` only apply those decisions to a live `DockviewApi`. The handful of things dockview does not expose publicly (a float's move+resize, the drag-end event) are quarantined behind one guarded adapter.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, Pinia, dockview-vue 8.3.x, vitest (node environment), custom Playwright runner under `scripts/e2e`.

**Spec:** `docs/superpowers/specs/2026-09-20-windows-desktop-shell-design.md`

## Global Constraints

- Work in `apps/web` only. The mobile shell (`apps/web/src/mobile/**`) must not change behaviour; below the mobile breakpoint dockview is never mounted.
- **Immutability:** every pure module returns new objects; never mutate an argument.
- **File size:** 200-400 lines typical, 800 max. `App.vue` is already 741 lines and loses code in this plan; it must not grow.
- **Tests run on the node environment.** `apps/web/vite.config.ts` sets no vitest `environment`, and none of the 102 existing test files use a DOM. Do not add `jsdom`, `happy-dom` or `@vue/test-utils`. Logic goes in pure modules with unit tests; DOM behaviour is covered by e2e.
- **i18n:** two catalogues, `apps/web/src/i18n/zh-CN.ts` (defines the `Messages` type) and `apps/web/src/i18n/en.ts`. Every new key goes in **both**, or `npm run typecheck -w apps/web` fails. Placeholders are `{name}`.
- **Commands:** `npm test -w apps/web` (vitest), `npm run typecheck -w apps/web` (vue-tsc), `npm run format -w apps/web` is not a thing — formatting is repo-wide `npm run format`. E2E is `npm run e2e` from the repo root and needs a live TeamSpeak test server; run it only where the task says so.
- **Commit style:** `<type>: <description>`, types `feat|fix|refactor|docs|test|chore|perf|ci`. End every commit message with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Storage keys:** the new layout key is `jinz.dock.layout.v4`; the window-state sidecar is `jinz.dock.windows.v1`. The old `jinz.dock.layout.v3`, `jinz.dock.videoSeen` and `jinz.dock.musicSeen` keys are deleted on first run.
- **Selectors e2e depends on — do not rename:** `data-testid="dock-close-group"` (window close button), `data-testid="status-reset-layout"` (status bar), the `dockview-theme-abyss` class on the dock container, `.dock-wrap` (theme skins target `.dock-wrap .mshell`), and the `window-bar` class (both theme skins style `.window-bar.glass-host`).

## File Structure

Created, all under `apps/web/src/dock/`:

| File                             | Responsibility                                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `box.ts`                         | The `Box` type and the two clamping helpers, lifted out of `floatDrop.ts` so placement, snap and float-drop share one definition.                      |
| `windowMeta.ts`                  | Window ids, their icon + i18n label, hub-feature gating, panel-id mapping. Replaces `summon.ts`.                                                       |
| `placement.ts`                   | Pure geometry: where a newly opened window goes, and the starter desktop. Replaces `layout.ts`.                                                        |
| `snap.ts`                        | Pure Aero Snap: which zone a dragged box arms, and the box a zone gives.                                                                               |
| `windowState.ts`                 | Pure, immutable minimised / maximised state keyed by panel id, plus its (de)serialisation.                                                             |
| `dockviewInternals.ts`           | The only file that reaches past `DockviewApi`, guarded.                                                                                                |
| `taskbar.ts`                     | Pure taskbar model: buttons from panels + window state, and what a click means.                                                                        |
| `useDesktop.ts`                  | The composable that owns the live `DockviewApi`: opening, revealing, minimising, maximising, snapping, persistence. Takes this logic out of `App.vue`. |
| `Desktop.vue`, `DesktopIcon.vue` | The watermark-slot desktop surface and one icon.                                                                                                       |
| `Taskbar.vue`                    | Replaces `WindowBar.vue`.                                                                                                                              |
| `SnapOverlay.vue`                | The snap preview rectangle.                                                                                                                            |
| `desktop.css`                    | Desktop, taskbar and minimised-window styling. Replaces `floatHint.css`'s role as the dock's stylesheet (the float hint itself stays).                 |

Modified: `App.vue` (shrinks to shell wiring), `dockWindows.ts` (rewritten around floating windows), `HeaderActions.vue` (window controls), `floatDrop.ts` (imports `Box` from `box.ts`), `panels.ts` (unchanged export, gains the desktop component), both i18n catalogues, both theme skins, `scripts/e2e/lib/rig.mjs` and four specs.

Deleted: `summon.ts`, `summon.test.ts`, `layout.ts`, `layout.test.ts`, `WindowBar.vue`.

---

### Task 1: Shared box type

Lifts `Box` and its clamping helpers out of `floatDrop.ts` so the three new geometry modules and the existing float-drop maths share one definition instead of redeclaring it.

**Files:**

- Create: `apps/web/src/dock/box.ts`
- Create: `apps/web/src/dock/box.test.ts`
- Modify: `apps/web/src/dock/floatDrop.ts` (remove the local `Box`, `fit`, `clamp`; import them)

**Interfaces:**

- Consumes: nothing.
- Produces: `interface Box { readonly x: number; readonly y: number; readonly width: number; readonly height: number }`, `interface DesktopSize { readonly width: number; readonly height: number }`, `function fitSize(preferred: number, available: number, minimum: number, maxShare: number): number`, `function clampNumber(value: number, min: number, max: number): number`, `function usableDesktop(width: number, height: number): DesktopSize | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/box.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clampNumber, fitSize, usableDesktop } from "./box";

describe("clampNumber", () => {
  it("keeps a value inside the range", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(42, 0, 10)).toBe(10);
  });

  it("falls back to the minimum for a value that is not a number", () => {
    expect(clampNumber(Number.NaN, 4, 10)).toBe(4);
  });
});

describe("fitSize", () => {
  it("keeps the preferred size when it fits", () => {
    expect(fitSize(460, 1000, 160, 0.8)).toBe(460);
  });

  it("shrinks to a share of a small container", () => {
    expect(fitSize(460, 400, 160, 0.8)).toBe(320);
  });

  it("never goes below the minimum", () => {
    expect(fitSize(460, 100, 160, 0.8)).toBe(160);
  });
});

describe("usableDesktop", () => {
  it("returns the size of a real box", () => {
    expect(usableDesktop(1280, 720)).toEqual({ width: 1280, height: 720 });
  });

  it("returns null for a box we cannot size against", () => {
    // dockview's container is 0x0 on the first frame; a detached element is NaN.
    expect(usableDesktop(0, 720)).toBeNull();
    expect(usableDesktop(1280, 0)).toBeNull();
    expect(usableDesktop(Number.NaN, 720)).toBeNull();
    expect(usableDesktop(1280, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- box.test`
Expected: FAIL — `Failed to resolve import "./box"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/box.ts`:

```ts
/**
 * The rectangle every part of the desktop speaks in, and the two clamps that
 * keep one inside its container.
 *
 * Pure and DOM-free: placement, snapping and the float-drop maths all size
 * boxes against a container they are handed, so they stay testable without a
 * live dock.
 */

/** A window's box, relative to the desktop's top-left corner. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The desktop's own box, which every other box is placed inside. */
export interface DesktopSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The desktop's size, or `null` for a box we cannot place anything against.
 *
 * dockview's container is still 0x0 on the first frame and a detached element
 * reports NaN, so callers skip and try again on the next frame rather than
 * placing a window at a nonsense position.
 */
export function usableDesktop(width: number, height: number): DesktopSize | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/** `preferred`, shrunk to `maxShare` of what is available but never below `minimum`. */
export function fitSize(
  preferred: number,
  available: number,
  minimum: number,
  maxShare: number,
): number {
  const cap = Math.max(minimum, Math.floor(available * maxShare));
  return Math.min(preferred, cap);
}

/** `value` inside `[min, max]`; a non-finite value becomes `min`. */
export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- box.test`
Expected: PASS, 8 tests.

- [ ] **Step 5: Point `floatDrop.ts` at the shared helpers**

In `apps/web/src/dock/floatDrop.ts`, delete the local `Box` interface and the `fit` and `clamp` functions at the bottom of the file, add the import at the top (below the file's doc comment):

```ts
import { clampNumber, fitSize, type Box } from "./box";

export type { Box };
```

and rewrite `floatBoxAt`'s body to use them:

```ts
export function floatBoxAt(
  pointX: number,
  pointY: number,
  dockWidth: number,
  dockHeight: number,
): Box {
  const width = fitSize(FLOAT_WIDTH, dockWidth, MIN_SIZE, MAX_SHARE);
  const height = fitSize(FLOAT_HEIGHT, dockHeight, MIN_SIZE, MAX_SHARE);
  return {
    x: clampNumber(Math.round(pointX - width / 2), 0, Math.max(0, dockWidth - width)),
    y: clampNumber(Math.round(pointY - FLOAT_GRAB_OFFSET), 0, Math.max(0, dockHeight - height)),
    width,
    height,
  };
}
```

Keep `MIN_SIZE` and `MAX_SHARE` where they are.

- [ ] **Step 6: Run the whole dock suite to verify nothing regressed**

Run: `npm test -w apps/web -- dock`
Expected: PASS — `box.test.ts`, `floatDrop.test.ts`, `layout.test.ts`, `summon.test.ts` all green. `floatDrop.test.ts`'s six `floatBoxAt` cases prove the move was behaviour-preserving.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/dock/box.ts apps/web/src/dock/box.test.ts apps/web/src/dock/floatDrop.ts
git commit -m "refactor: share the dock's box type and clamps

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Window metadata

One table of which windows exist, what they look like on the desktop and in the taskbar, and which the connected hub offers. Today this is split between `summon.ts`'s `summonableWindows` and `WindowBar.vue`'s private `LABELS`, which the desktop icons would otherwise have to duplicate.

**Files:**

- Create: `apps/web/src/dock/windowMeta.ts`
- Create: `apps/web/src/dock/windowMeta.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `type WindowId = "tree" | "apps" | "sounds" | "files" | "video" | "chat" | "info" | "music"`, `const SERVER_CHAT_PANEL = "chat:server"`, `const CHAT_PREFIX = "chat:"`, `interface HubFeatures { readonly video: boolean; readonly music: boolean; readonly files: boolean }`, `const WINDOW_META: Record<WindowId, { readonly icon: string; readonly key: MessageKey }>`, `function availableWindows(features: HubFeatures): readonly WindowId[]`, `function windowPanelId(id: WindowId): string`, `function iconForPanel(panelId: string): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/windowMeta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { availableWindows, iconForPanel, WINDOW_META, windowPanelId } from "./windowMeta";

const ALL = { video: true, music: true, files: true };

describe("availableWindows", () => {
  it("lists every window when the hub offers everything", () => {
    expect(availableWindows(ALL)).toEqual([
      "tree",
      "apps",
      "sounds",
      "files",
      "video",
      "chat",
      "info",
      "music",
    ]);
  });

  it("drops the windows the hub has no feature for", () => {
    expect(availableWindows({ video: false, music: false, files: false })).toEqual([
      "tree",
      "apps",
      "sounds",
      "chat",
      "info",
    ]);
  });

  it("drops only the missing one", () => {
    expect(availableWindows({ ...ALL, music: false })).not.toContain("music");
    expect(availableWindows({ ...ALL, music: false })).toContain("video");
  });
});

describe("windowPanelId", () => {
  it("maps the chat button to the server chat panel", () => {
    expect(windowPanelId("chat")).toBe("chat:server");
  });

  it("leaves every other window's id alone", () => {
    expect(windowPanelId("tree")).toBe("tree");
    expect(windowPanelId("music")).toBe("music");
  });
});

describe("iconForPanel", () => {
  it("gives a static panel its own icon", () => {
    expect(iconForPanel("tree")).toBe(WINDOW_META.tree.icon);
  });

  it("gives every conversation the chat icon", () => {
    expect(iconForPanel("chat:server")).toBe(WINDOW_META.chat.icon);
    expect(iconForPanel("chat:channel:7")).toBe(WINDOW_META.chat.icon);
    expect(iconForPanel("chat:client:42")).toBe(WINDOW_META.chat.icon);
  });

  it("falls back to a neutral icon for a panel it does not know", () => {
    expect(iconForPanel("something-new")).toBe("▫");
  });
});

describe("WINDOW_META", () => {
  it("has an entry for every window", () => {
    for (const id of availableWindows(ALL)) {
      expect(WINDOW_META[id]).toBeDefined();
      expect(WINDOW_META[id].icon).not.toBe("");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- windowMeta`
Expected: FAIL — `Failed to resolve import "./windowMeta"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/windowMeta.ts`:

```ts
import type { MessageKey } from "../i18n";

/**
 * Which windows the desktop has, and how each one shows itself.
 *
 * One table for the desktop icons and the taskbar: they used to be a bar of
 * buttons with a private label table, and the icons would have had to repeat it.
 * Pure data plus feature gating, so it is testable and the mobile shell can
 * share the gating rather than keeping its own copy.
 */

/** A window the desktop has an icon for. `chat` stands for the server chat. */
export type WindowId = "tree" | "apps" | "sounds" | "files" | "video" | "chat" | "info" | "music";

/** The dock panel id behind the chat icon. */
export const SERVER_CHAT_PANEL = "chat:server";
/** Every conversation's panel id starts with this. */
export const CHAT_PREFIX = "chat:";
/** A panel the desktop has no icon for still needs something in the taskbar. */
const FALLBACK_ICON = "▫";

/** Optional windows the connected hub actually offers. */
export interface HubFeatures {
  readonly video: boolean;
  readonly music: boolean;
  /** File transfer: older hubs have none, and then there are no files to browse. */
  readonly files: boolean;
}

/** The icon and the title key of each window. */
export const WINDOW_META: Record<WindowId, { readonly icon: string; readonly key: MessageKey }> = {
  tree: { icon: "☰", key: "tree.title" },
  apps: { icon: "🧩", key: "apps.title" },
  sounds: { icon: "🔊", key: "sound.title" },
  files: { icon: "📁", key: "fb.title" },
  video: { icon: "🎥", key: "video.title" },
  chat: { icon: "💬", key: "chat.title" },
  info: { icon: "ℹ️", key: "info.title" },
  music: { icon: "🎵", key: "music.title" },
};

/** Desktop icons in display order; optional windows only when the hub offers them. */
export function availableWindows(features: HubFeatures): readonly WindowId[] {
  return [
    "tree",
    "apps",
    "sounds",
    ...(features.files ? (["files"] as const) : []),
    ...(features.video ? (["video"] as const) : []),
    "chat",
    "info",
    ...(features.music ? (["music"] as const) : []),
  ];
}

/** The dock panel id an icon stands for. */
export function windowPanelId(id: WindowId): string {
  return id === "chat" ? SERVER_CHAT_PANEL : id;
}

/** The icon for a live panel, whose id may be any conversation. */
export function iconForPanel(panelId: string): string {
  if (panelId.startsWith(CHAT_PREFIX)) return WINDOW_META.chat.icon;
  return WINDOW_META[panelId as WindowId]?.icon ?? FALLBACK_ICON;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- windowMeta`
Expected: PASS, 9 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: no errors. If `MessageKey` is not exported from `../i18n`, check `apps/web/src/i18n/index.ts` — `WindowBar.vue` imports it as `import { useI18n, type MessageKey } from "../i18n"`, so it is.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/dock/windowMeta.ts apps/web/src/dock/windowMeta.test.ts
git commit -m "feat: one table of the desktop's windows

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Window placement

Where a window lands when it is opened, and the starter desktop a new user sees. Replaces `layout.ts`, whose pixel maths sized dockview grid columns; the same 20% / 54% / 26% proportions now size floating windows so the first screen still looks like today's layout.

**Files:**

- Create: `apps/web/src/dock/placement.ts`
- Create: `apps/web/src/dock/placement.test.ts`

**Interfaces:**

- Consumes: `Box`, `DesktopSize`, `clampNumber`, `fitSize` from `./box` (Task 1); `WindowId`, `HubFeatures`, `availableWindows`, `windowPanelId` from `./windowMeta` (Task 2).
- Produces: `function cascadeBox(index: number, desktop: DesktopSize): Box`, `interface StarterWindow { readonly id: WindowId; readonly panelId: string; readonly box: Box }`, `function starterDesktop(features: HubFeatures, desktop: DesktopSize): readonly StarterWindow[]`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/placement.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cascadeBox, starterDesktop } from "./placement";
import type { Box } from "./box";

const DESKTOP = { width: 1600, height: 900 };
const ALL = { video: true, music: true, files: true };

const right = (b: Box) => b.x + b.width;
const bottom = (b: Box) => b.y + b.height;

describe("cascadeBox", () => {
  it("puts the first window near the top-left, at its preferred size", () => {
    const box = cascadeBox(0, DESKTOP);
    expect(box.x).toBeGreaterThan(0);
    expect(box.y).toBeGreaterThan(0);
    expect(box.width).toBe(720);
    expect(box.height).toBe(480);
  });

  it("steps each further window down and to the right", () => {
    const first = cascadeBox(0, DESKTOP);
    const second = cascadeBox(1, DESKTOP);
    expect(second.x).toBeGreaterThan(first.x);
    expect(second.y).toBeGreaterThan(first.y);
  });

  it("wraps back to the start rather than walking off the desktop", () => {
    for (let i = 0; i < 40; i++) {
      const box = cascadeBox(i, DESKTOP);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(right(box)).toBeLessThanOrEqual(DESKTOP.width);
      expect(bottom(box)).toBeLessThanOrEqual(DESKTOP.height);
    }
  });

  it("shrinks the window to fit a small desktop", () => {
    const box = cascadeBox(0, { width: 500, height: 400 });
    expect(right(box)).toBeLessThanOrEqual(500);
    expect(bottom(box)).toBeLessThanOrEqual(400);
  });
});

describe("starterDesktop", () => {
  it("opens the tree, the chat and the info panel, plus video and music", () => {
    expect(starterDesktop(ALL, DESKTOP).map((w) => w.id)).toEqual([
      "tree",
      "video",
      "chat",
      "info",
      "music",
    ]);
  });

  it("names each window's panel, so the chat is the server chat", () => {
    const chat = starterDesktop(ALL, DESKTOP).find((w) => w.id === "chat");
    expect(chat?.panelId).toBe("chat:server");
  });

  it("leaves out what the hub does not offer", () => {
    const ids = starterDesktop({ video: false, music: false, files: false }, DESKTOP).map(
      (w) => w.id,
    );
    expect(ids).toEqual(["tree", "chat", "info"]);
  });

  it("tiles the desktop: every window inside it, none overlapping", () => {
    const windows = starterDesktop(ALL, DESKTOP);
    for (const w of windows) {
      expect(w.box.x).toBeGreaterThanOrEqual(0);
      expect(w.box.y).toBeGreaterThanOrEqual(0);
      expect(right(w.box)).toBeLessThanOrEqual(DESKTOP.width);
      expect(bottom(w.box)).toBeLessThanOrEqual(DESKTOP.height);
      expect(w.box.width).toBeGreaterThan(0);
      expect(w.box.height).toBeGreaterThan(0);
    }
    for (let i = 0; i < windows.length; i++) {
      for (let j = i + 1; j < windows.length; j++) {
        const a = windows[i]!.box;
        const b = windows[j]!.box;
        const apart = right(a) <= b.x || right(b) <= a.x || bottom(a) <= b.y || bottom(b) <= a.y;
        expect(apart, `${windows[i]!.id} overlaps ${windows[j]!.id}`).toBe(true);
      }
    }
  });

  it("keeps the tree's fifth of the width and the music column's quarter", () => {
    const windows = starterDesktop(ALL, DESKTOP);
    const tree = windows.find((w) => w.id === "tree")!.box;
    const music = windows.find((w) => w.id === "music")!.box;
    expect(tree.width).toBe(Math.round(DESKTOP.width * 0.2));
    expect(music.width).toBe(Math.round(DESKTOP.width * 0.26));
    expect(tree.x).toBe(0);
    expect(right(music)).toBe(DESKTOP.width);
  });

  it("stacks the video over the chat and info row", () => {
    const windows = starterDesktop(ALL, DESKTOP);
    const video = windows.find((w) => w.id === "video")!.box;
    const chat = windows.find((w) => w.id === "chat")!.box;
    expect(bottom(video)).toBeLessThanOrEqual(chat.y);
    expect(video.height).toBe(Math.round(DESKTOP.height * 0.43));
  });

  it("gives the middle column the whole height when there is no video", () => {
    const windows = starterDesktop({ ...ALL, video: false }, DESKTOP);
    const chat = windows.find((w) => w.id === "chat")!.box;
    expect(chat.y).toBe(0);
    expect(bottom(chat)).toBe(DESKTOP.height);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- placement`
Expected: FAIL — `Failed to resolve import "./placement"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/placement.ts`:

```ts
import { clampNumber, fitSize, type Box, type DesktopSize } from "./box";
import { windowPanelId, type HubFeatures, type WindowId } from "./windowMeta";

/**
 * Where a window goes on the desktop.
 *
 * Two jobs: the cascade a window opened from its icon falls into, and the
 * starter desktop a new user gets. The starter arrangement keeps the
 * proportions of the old docked layout (tree a fifth, music a quarter, the
 * video over a chat/info row), so the client still looks like itself — the
 * columns are just windows now.
 *
 * Pure: everything is computed against a desktop size the caller measures.
 */

/** Preferred size of a window opened from its icon. */
const CASCADE_WIDTH = 720;
const CASCADE_HEIGHT = 480;
/** How far each further window steps from the one before it. */
const CASCADE_STEP = 28;
/** How many windows the cascade walks before it starts again. */
const CASCADE_LENGTH = 8;
/** Where the cascade starts, and the smallest window it will place. */
const CASCADE_ORIGIN = 24;
const MIN_SIZE = 200;
const MAX_SHARE = 0.9;

/** Share of the desktop taken by the channel tree. */
export const TREE_WIDTH_RATIO = 0.2;
/** Share of the desktop taken by the music column. */
export const MUSIC_WIDTH_RATIO = 0.26;
/** Share of the height taken by the video, above the chat/info row. */
export const VIDEO_HEIGHT_RATIO = 0.43;

/** The box for the `index`-th window opened from an icon. */
export function cascadeBox(index: number, desktop: DesktopSize): Box {
  const width = fitSize(CASCADE_WIDTH, desktop.width, MIN_SIZE, MAX_SHARE);
  const height = fitSize(CASCADE_HEIGHT, desktop.height, MIN_SIZE, MAX_SHARE);
  // The cascade restarts rather than walking a long-lived desktop off its edge.
  const step = (Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0) % CASCADE_LENGTH;
  const offset = CASCADE_ORIGIN + step * CASCADE_STEP;
  return {
    x: clampNumber(offset, 0, Math.max(0, desktop.width - width)),
    y: clampNumber(offset, 0, Math.max(0, desktop.height - height)),
    width,
    height,
  };
}

/** One window of the starter desktop. */
export interface StarterWindow {
  readonly id: WindowId;
  readonly panelId: string;
  readonly box: Box;
}

/**
 * The desktop a user sees on their first connect: three columns, with the
 * video stacked over the middle one.
 *
 *   tree (20%) | [ video ] over [ chat | info ] | music (26%)
 */
export function starterDesktop(
  features: HubFeatures,
  desktop: DesktopSize,
): readonly StarterWindow[] {
  const treeWidth = Math.round(desktop.width * TREE_WIDTH_RATIO);
  const musicWidth = features.music ? Math.round(desktop.width * MUSIC_WIDTH_RATIO) : 0;
  const middleX = treeWidth;
  const middleWidth = desktop.width - treeWidth - musicWidth;
  const videoHeight = features.video ? Math.round(desktop.height * VIDEO_HEIGHT_RATIO) : 0;
  const rowY = videoHeight;
  const rowHeight = desktop.height - videoHeight;
  const chatWidth = Math.round(middleWidth / 2);

  const at = (id: WindowId, box: Box): StarterWindow => ({
    id,
    panelId: windowPanelId(id),
    box,
  });

  return [
    at("tree", { x: 0, y: 0, width: treeWidth, height: desktop.height }),
    ...(features.video
      ? [at("video", { x: middleX, y: 0, width: middleWidth, height: videoHeight })]
      : []),
    at("chat", { x: middleX, y: rowY, width: chatWidth, height: rowHeight }),
    at("info", {
      x: middleX + chatWidth,
      y: rowY,
      width: middleWidth - chatWidth,
      height: rowHeight,
    }),
    ...(features.music
      ? [at("music", { x: middleX + middleWidth, y: 0, width: musicWidth, height: desktop.height })]
      : []),
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- placement`
Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w apps/web`
Expected: no errors.

```bash
git add apps/web/src/dock/placement.ts apps/web/src/dock/placement.test.ts
git commit -m "feat: place desktop windows and the starter layout

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Aero Snap geometry

Which zone a dragged window arms, and the box that zone gives it. Pure, so the whole snap behaviour is tested without a drag.

**Files:**

- Create: `apps/web/src/dock/snap.ts`
- Create: `apps/web/src/dock/snap.test.ts`

**Interfaces:**

- Consumes: `Box`, `DesktopSize` from `./box` (Task 1).
- Produces: `type SnapZone = "left" | "right" | "top" | "top-left" | "top-right" | "bottom-left" | "bottom-right"`, `interface SnapInput { readonly box: Box; readonly desktop: DesktopSize; readonly current: SnapZone | null; readonly suspended: boolean }`, `function snapZoneFor(input: SnapInput): SnapZone | null`, `function snapBox(zone: SnapZone, desktop: DesktopSize): Box`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/snap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { snapBox, snapZoneFor, type SnapZone } from "./snap";
import type { Box } from "./box";

const DESKTOP = { width: 1000, height: 800 };
const SIZE = { width: 400, height: 300 };

/** A dragged window's box with its top-left at (x, y). */
const at = (x: number, y: number): Box => ({ x, y, ...SIZE });

const zone = (box: Box, current: SnapZone | null = null, suspended = false) =>
  snapZoneFor({ box, desktop: DESKTOP, current, suspended });

describe("snapZoneFor", () => {
  it("arms nothing in the middle of the desktop", () => {
    expect(zone(at(300, 300))).toBeNull();
  });

  it("arms the left half against the left edge", () => {
    expect(zone(at(2, 300))).toBe("left");
  });

  it("arms the right half when the window's right edge reaches the desktop's", () => {
    expect(zone(at(DESKTOP.width - SIZE.width - 2, 300))).toBe("right");
  });

  it("maximises against the top edge", () => {
    expect(zone(at(300, 2))).toBe("top");
  });

  it("arms a quarter in each corner", () => {
    expect(zone(at(2, 2))).toBe("top-left");
    expect(zone(at(DESKTOP.width - SIZE.width - 2, 2))).toBe("top-right");
    expect(zone(at(2, DESKTOP.height - SIZE.height - 2))).toBe("bottom-left");
    expect(zone(at(DESKTOP.width - SIZE.width - 2, DESKTOP.height - SIZE.height - 2))).toBe(
      "bottom-right",
    );
  });

  it("arms nothing against the bottom edge alone: that is not a Windows gesture", () => {
    expect(zone(at(300, DESKTOP.height - SIZE.height - 2))).toBeNull();
  });

  it("arms nothing while snapping is suspended", () => {
    expect(zone(at(2, 2), null, true)).toBeNull();
    expect(zone(at(2, 2), "top-left", true)).toBeNull();
  });

  it("holds an armed zone until the window is clearly away from the edge", () => {
    // Just past the arming distance: hysteresis keeps it, so the preview does
    // not flicker while the pointer jitters on the boundary.
    expect(zone(at(14, 300), "left")).toBe("left");
    // Well past it: released.
    expect(zone(at(40, 300), "left")).toBeNull();
  });

  it("arms nothing against a desktop it cannot measure", () => {
    expect(
      snapZoneFor({
        box: at(0, 0),
        desktop: { width: 0, height: 0 },
        current: null,
        suspended: false,
      }),
    ).toBeNull();
  });
});

describe("snapBox", () => {
  it("halves the desktop for the left and right zones", () => {
    expect(snapBox("left", DESKTOP)).toEqual({ x: 0, y: 0, width: 500, height: 800 });
    expect(snapBox("right", DESKTOP)).toEqual({ x: 500, y: 0, width: 500, height: 800 });
  });

  it("fills the desktop for the top zone", () => {
    expect(snapBox("top", DESKTOP)).toEqual({ x: 0, y: 0, width: 1000, height: 800 });
  });

  it("quarters the desktop for the corners", () => {
    expect(snapBox("top-left", DESKTOP)).toEqual({ x: 0, y: 0, width: 500, height: 400 });
    expect(snapBox("top-right", DESKTOP)).toEqual({ x: 500, y: 0, width: 500, height: 400 });
    expect(snapBox("bottom-left", DESKTOP)).toEqual({ x: 0, y: 400, width: 500, height: 400 });
    expect(snapBox("bottom-right", DESKTOP)).toEqual({ x: 500, y: 400, width: 500, height: 400 });
  });

  it("covers the desktop exactly with an odd width", () => {
    const odd = { width: 1001, height: 801 };
    const left = snapBox("left", odd);
    const rightHalf = snapBox("right", odd);
    expect(left.width + rightHalf.width).toBe(odd.width);
    expect(rightHalf.x).toBe(left.width);
    const topLeft = snapBox("top-left", odd);
    const bottomLeft = snapBox("bottom-left", odd);
    expect(topLeft.height + bottomLeft.height).toBe(odd.height);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- snap`
Expected: FAIL — `Failed to resolve import "./snap"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/snap.ts`:

```ts
import { usableDesktop, type Box, type DesktopSize } from "./box";

/**
 * Aero Snap: drag a window against an edge and it takes half the desktop, into
 * a corner and it takes a quarter, against the top and it fills the desktop.
 *
 * Pure. The drag hook hands in the window's proposed box each frame and gets
 * back the zone to preview; the drop then asks for that zone's box. Keeping the
 * decision here means the whole gesture is tested without a drag.
 */

export type SnapZone =
  "left" | "right" | "top" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** How close an edge has to come to the desktop's to arm a zone. */
export const SNAP_DISTANCE = 12;
/** How much further it has to travel before an armed zone lets go. */
export const RELEASE_DISTANCE = 16;

export interface SnapInput {
  /** The window's proposed box this frame. */
  readonly box: Box;
  readonly desktop: DesktopSize;
  /** The zone armed on the previous frame, for hysteresis. */
  readonly current: SnapZone | null;
  /** True while the user holds the modifier that drags freely. */
  readonly suspended: boolean;
}

/**
 * The zone `box` arms, or `null`.
 *
 * An already-armed zone holds on for a little longer than it took to arm, so a
 * pointer jittering on the boundary does not flicker the preview on and off.
 * The bottom edge on its own arms nothing: in Windows it is the corners that
 * matter down there, and a window dragged low would otherwise keep snapping.
 */
export function snapZoneFor(input: SnapInput): SnapZone | null {
  if (input.suspended) return null;
  const desktop = usableDesktop(input.desktop.width, input.desktop.height);
  if (!desktop) return null;
  const { box, current } = input;
  const reach = current ? SNAP_DISTANCE + RELEASE_DISTANCE : SNAP_DISTANCE;

  const nearLeft = box.x <= reach;
  const nearRight = box.x + box.width >= desktop.width - reach;
  const nearTop = box.y <= reach;
  const nearBottom = box.y + box.height >= desktop.height - reach;

  if (nearTop && nearLeft) return "top-left";
  if (nearTop && nearRight) return "top-right";
  if (nearBottom && nearLeft) return "bottom-left";
  if (nearBottom && nearRight) return "bottom-right";
  if (nearTop) return "top";
  if (nearLeft) return "left";
  if (nearRight) return "right";
  return null;
}

/** The box a zone gives, tiling the desktop exactly. */
export function snapBox(zone: SnapZone, desktop: DesktopSize): Box {
  // The left/top halves round down so the right/bottom ones take the odd pixel
  // and the two together cover the desktop with no seam.
  const half = Math.floor(desktop.width / 2);
  const middle = Math.floor(desktop.height / 2);
  const rest = desktop.width - half;
  const lower = desktop.height - middle;
  switch (zone) {
    case "top":
      return { x: 0, y: 0, width: desktop.width, height: desktop.height };
    case "left":
      return { x: 0, y: 0, width: half, height: desktop.height };
    case "right":
      return { x: half, y: 0, width: rest, height: desktop.height };
    case "top-left":
      return { x: 0, y: 0, width: half, height: middle };
    case "top-right":
      return { x: half, y: 0, width: rest, height: middle };
    case "bottom-left":
      return { x: 0, y: middle, width: half, height: lower };
    case "bottom-right":
      return { x: half, y: middle, width: rest, height: lower };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- snap`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w apps/web`

```bash
git add apps/web/src/dock/snap.ts apps/web/src/dock/snap.test.ts
git commit -m "feat: Aero Snap zone and box maths

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Window state

Which windows are minimised, which are maximised, and the box a maximised one goes back to. dockview serialises none of this for floating groups — and serialising a `display:none` float would record it as 0x0 — so the desktop keeps its own immutable state map and persists it beside dockview's layout.

**Files:**

- Create: `apps/web/src/dock/windowState.ts`
- Create: `apps/web/src/dock/windowState.test.ts`

**Interfaces:**

- Consumes: `Box` from `./box` (Task 1).
- Produces: `interface WindowState { readonly minimized: boolean; readonly restore: Box | null }`, `type WindowStates = Readonly<Record<string, WindowState>>`, `const NO_WINDOWS: WindowStates`, `function stateOf(states: WindowStates, panelId: string): WindowState`, `function isMinimized(states, panelId): boolean`, `function isMaximized(states, panelId): boolean`, `function setMinimized(states, panelId, minimized: boolean): WindowStates`, `function setMaximized(states, panelId, restore: Box | null): WindowStates`, `function forgetWindow(states, panelId): WindowStates`, `function pruneStates(states, liveIds: readonly string[]): WindowStates`, `function parseStates(raw: string | null): WindowStates`, `function serializeStates(states): string`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/windowState.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  forgetWindow,
  isMaximized,
  isMinimized,
  NO_WINDOWS,
  parseStates,
  pruneStates,
  serializeStates,
  setMaximized,
  setMinimized,
  stateOf,
} from "./windowState";

const BOX = { x: 10, y: 20, width: 300, height: 200 };

describe("stateOf", () => {
  it("reports a window it has never seen as open and not maximised", () => {
    expect(stateOf(NO_WINDOWS, "tree")).toEqual({ minimized: false, restore: null });
  });
});

describe("setMinimized", () => {
  it("minimises a window without touching the map it was given", () => {
    const next = setMinimized(NO_WINDOWS, "tree", true);
    expect(isMinimized(next, "tree")).toBe(true);
    expect(isMinimized(NO_WINDOWS, "tree")).toBe(false);
  });

  it("restores it again", () => {
    const next = setMinimized(setMinimized(NO_WINDOWS, "tree", true), "tree", false);
    expect(isMinimized(next, "tree")).toBe(false);
  });

  it("keeps the maximised box across a minimise", () => {
    const max = setMaximized(NO_WINDOWS, "tree", BOX);
    const min = setMinimized(max, "tree", true);
    expect(isMaximized(min, "tree")).toBe(true);
    expect(stateOf(min, "tree").restore).toEqual(BOX);
  });

  it("leaves the other windows alone", () => {
    const both = setMinimized(setMinimized(NO_WINDOWS, "tree", true), "info", true);
    expect(isMinimized(both, "tree")).toBe(true);
    expect(isMinimized(both, "info")).toBe(true);
  });
});

describe("setMaximized", () => {
  it("remembers the box to restore to", () => {
    const next = setMaximized(NO_WINDOWS, "tree", BOX);
    expect(isMaximized(next, "tree")).toBe(true);
    expect(stateOf(next, "tree").restore).toEqual(BOX);
  });

  it("un-maximises with null", () => {
    const next = setMaximized(setMaximized(NO_WINDOWS, "tree", BOX), "tree", null);
    expect(isMaximized(next, "tree")).toBe(false);
    expect(stateOf(next, "tree").restore).toBeNull();
  });
});

describe("forgetWindow and pruneStates", () => {
  it("forgets a closed window", () => {
    const next = forgetWindow(setMinimized(NO_WINDOWS, "tree", true), "tree");
    expect(isMinimized(next, "tree")).toBe(false);
  });

  it("drops the state of windows that are no longer in the layout", () => {
    const states = setMinimized(setMinimized(NO_WINDOWS, "tree", true), "info", true);
    const next = pruneStates(states, ["tree"]);
    expect(isMinimized(next, "tree")).toBe(true);
    expect(Object.keys(next)).toEqual(["tree"]);
  });
});

describe("parseStates and serializeStates", () => {
  it("round-trips", () => {
    const states = setMaximized(setMinimized(NO_WINDOWS, "info", true), "tree", BOX);
    expect(parseStates(serializeStates(states))).toEqual(states);
  });

  it("treats nothing saved as nothing minimised", () => {
    expect(parseStates(null)).toEqual(NO_WINDOWS);
    expect(parseStates("")).toEqual(NO_WINDOWS);
  });

  it("survives junk rather than wedging the desktop", () => {
    expect(parseStates("not json")).toEqual(NO_WINDOWS);
    expect(parseStates("[1,2,3]")).toEqual(NO_WINDOWS);
    expect(parseStates('{"tree":"yes"}')).toEqual(NO_WINDOWS);
  });

  it("drops an entry whose restore box is not a box", () => {
    const parsed = parseStates('{"tree":{"minimized":true,"restore":{"x":1}}}');
    expect(isMinimized(parsed, "tree")).toBe(true);
    expect(stateOf(parsed, "tree").restore).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- windowState`
Expected: FAIL — `Failed to resolve import "./windowState"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/windowState.ts`:

```ts
import type { Box } from "./box";

/**
 * Which windows are minimised or maximised, and where a maximised one goes back to.
 *
 * dockview does not serialise either for a floating group, and hiding one with
 * its own `setVisible` would let it re-clamp the window from a zero-sized box,
 * so the desktop keeps this itself and saves it beside dockview's layout.
 *
 * Immutable throughout: every function returns a new map.
 */

export interface WindowState {
  readonly minimized: boolean;
  /** The box to restore to, set only while the window is maximised. */
  readonly restore: Box | null;
}

/** Window state by dock panel id. */
export type WindowStates = Readonly<Record<string, WindowState>>;

const OPEN: WindowState = { minimized: false, restore: null };

/** No window minimised, none maximised. */
export const NO_WINDOWS: WindowStates = Object.freeze({});

export function stateOf(states: WindowStates, panelId: string): WindowState {
  return states[panelId] ?? OPEN;
}

export function isMinimized(states: WindowStates, panelId: string): boolean {
  return stateOf(states, panelId).minimized;
}

export function isMaximized(states: WindowStates, panelId: string): boolean {
  return stateOf(states, panelId).restore !== null;
}

/** A new map with `panelId` set to `state`, or with it removed when it is plain. */
function withState(states: WindowStates, panelId: string, state: WindowState): WindowStates {
  const next = { ...states };
  if (!state.minimized && state.restore === null) delete next[panelId];
  else next[panelId] = state;
  return next;
}

export function setMinimized(
  states: WindowStates,
  panelId: string,
  minimized: boolean,
): WindowStates {
  return withState(states, panelId, { ...stateOf(states, panelId), minimized });
}

/** Maximises with the box to come back to, or un-maximises with `null`. */
export function setMaximized(
  states: WindowStates,
  panelId: string,
  restore: Box | null,
): WindowStates {
  return withState(states, panelId, { ...stateOf(states, panelId), restore });
}

/** Forgets a window, for when it is closed. */
export function forgetWindow(states: WindowStates, panelId: string): WindowStates {
  const next = { ...states };
  delete next[panelId];
  return next;
}

/** Drops the state of every window that is no longer in the layout. */
export function pruneStates(states: WindowStates, liveIds: readonly string[]): WindowStates {
  const live = new Set(liveIds);
  const next: Record<string, WindowState> = {};
  for (const [id, state] of Object.entries(states)) {
    if (live.has(id)) next[id] = state;
  }
  return next;
}

function asBox(value: unknown): Box | null {
  if (!value || typeof value !== "object") return null;
  const box = value as Record<string, unknown>;
  const numbers = [box.x, box.y, box.width, box.height];
  if (!numbers.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  return {
    x: box.x as number,
    y: box.y as number,
    width: box.width as number,
    height: box.height as number,
  };
}

/**
 * Reads the saved state back.
 *
 * Anything that is not the shape we wrote is dropped rather than trusted: this
 * comes from localStorage, which another tab, an older build or a user can have
 * written, and a desktop that refuses to start is worse than one that forgets
 * which window was minimised.
 */
export function parseStates(raw: string | null): WindowStates {
  if (!raw) return NO_WINDOWS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_WINDOWS;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return NO_WINDOWS;
  const next: Record<string, WindowState> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const state = value as Record<string, unknown>;
    next[id] = {
      minimized: state.minimized === true,
      restore: asBox(state.restore),
    };
  }
  return next;
}

export function serializeStates(states: WindowStates): string {
  return JSON.stringify(states);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- windowState`
Expected: PASS, 13 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w apps/web`

```bash
git add apps/web/src/dock/windowState.ts apps/web/src/dock/windowState.test.ts
git commit -m "feat: track which desktop windows are minimised or maximised

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Taskbar model

The taskbar's buttons and what clicking one does, as data. Keeps `Taskbar.vue` to markup and lets the behaviour be tested on the node environment, the way the rest of this repo tests UI logic.

**Files:**

- Create: `apps/web/src/dock/taskbar.ts`
- Create: `apps/web/src/dock/taskbar.test.ts`

**Interfaces:**

- Consumes: `iconForPanel` from `./windowMeta` (Task 2); `WindowStates`, `isMinimized` from `./windowState` (Task 5).
- Produces: `interface PanelSnapshot { readonly id: string; readonly title: string }`, `interface TaskbarButton { readonly panelId: string; readonly title: string; readonly icon: string; readonly active: boolean; readonly minimized: boolean }`, `type TaskbarAction = "raise" | "minimize"`, `function taskbarButtons(panels: readonly PanelSnapshot[], activeId: string | null, states: WindowStates): readonly TaskbarButton[]`, `function taskbarAction(button: TaskbarButton): TaskbarAction`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/taskbar.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- taskbar`
Expected: FAIL — `Failed to resolve import "./taskbar"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/taskbar.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- taskbar`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w apps/web`

```bash
git add apps/web/src/dock/taskbar.ts apps/web/src/dock/taskbar.test.ts
git commit -m "feat: taskbar buttons and click semantics

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: dockview internals adapter

Three things the desktop needs are not on `DockviewApi`: a floating window's box, moving and resizing one, and the event that fires when a float's drag ends. All three exist on dockview's component object at runtime. This task puts every cast in one guarded file, so a dockview upgrade that moves them breaks one module and degrades the desktop to plain floating windows instead of breaking the client.

**Files:**

- Create: `apps/web/src/dock/dockviewInternals.ts`
- Create: `apps/web/src/dock/dockviewInternals.test.ts`

**Interfaces:**

- Consumes: `Box` from `./box` (Task 1).
- Produces: `interface FloatingWindows { boxOf(group: unknown): Box | null; position(group: unknown, box: Box): boolean; onDragEnd(handler: (group: unknown) => void): { dispose(): void }; readonly available: boolean }`, `function floatingWindows(api: unknown): FloatingWindows`, `function overlayElementOf(group: { element?: unknown }): HTMLElement | null`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/dock/dockviewInternals.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { floatingWindows } from "./dockviewInternals";

const BOX = { x: 10, y: 20, width: 300, height: 200 };

/** A stand-in for dockview's component object, shaped the way it really is. */
function fakeApi(group: object, position = vi.fn()) {
  const overlay = { toJSON: () => ({ left: 10, top: 20, width: 300, height: 200 }) };
  return {
    component: {
      floatingGroups: [{ group, position, overlay }],
      onDidEndFloatingGroupDrag: (handler: (g: unknown) => void) => {
        handlers.push(handler);
        return { dispose: () => void 0 };
      },
    },
  };
}
const handlers: ((g: unknown) => void)[] = [];

describe("floatingWindows", () => {
  it("reports itself available for a real component object", () => {
    expect(floatingWindows(fakeApi({})).available).toBe(true);
  });

  it("reads a floating window's box", () => {
    const group = {};
    expect(floatingWindows(fakeApi(group)).boxOf(group)).toEqual(BOX);
  });

  it("moves and resizes a floating window in one call, anchored top-left", () => {
    const group = {};
    const position = vi.fn();
    const ok = floatingWindows(fakeApi(group, position)).position(group, BOX);
    expect(ok).toBe(true);
    // `top` and `left` are always passed so the overlay's anchor stays put.
    expect(position).toHaveBeenCalledWith({ top: 20, left: 10, width: 300, height: 200 });
  });

  it("reports a group it does not hold rather than throwing", () => {
    const windows = floatingWindows(fakeApi({}));
    expect(windows.boxOf({})).toBeNull();
    expect(windows.position({}, BOX)).toBe(false);
  });

  it("forwards the drag-end event", () => {
    handlers.length = 0;
    const group = {};
    const seen: unknown[] = [];
    floatingWindows(fakeApi(group)).onDragEnd((g) => seen.push(g));
    handlers.forEach((h) => h(group));
    expect(seen).toEqual([group]);
  });

  it("degrades to a no-op when dockview has no component object", () => {
    const windows = floatingWindows({});
    expect(windows.available).toBe(false);
    expect(windows.boxOf({})).toBeNull();
    expect(windows.position({}, BOX)).toBe(false);
    expect(() => windows.onDragEnd(() => void 0).dispose()).not.toThrow();
  });

  it("degrades to a no-op for a component object of the wrong shape", () => {
    const windows = floatingWindows({ component: { floatingGroups: "nope" } });
    expect(windows.available).toBe(false);
    expect(windows.position({}, BOX)).toBe(false);
  });

  it("survives an overlay whose box is not numbers", () => {
    const group = {};
    const api = {
      component: {
        floatingGroups: [{ group, position: vi.fn(), overlay: { toJSON: () => ({ left: "x" }) } }],
        onDidEndFloatingGroupDrag: () => ({ dispose: () => void 0 }),
      },
    };
    expect(floatingWindows(api).boxOf(group)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w apps/web -- dockviewInternals`
Expected: FAIL — `Failed to resolve import "./dockviewInternals"`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/dock/dockviewInternals.ts`:

```ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Box } from "./box";

/**
 * The only file that reaches past `DockviewApi`.
 *
 * A Windows-style desktop needs three things dockview keeps to itself: a
 * floating window's box, a call that moves *and* resizes one, and the event
 * that fires when a float's drag ends. `group.api.setSize` resizes but cannot
 * move; `group.api.maximize()` returns immediately for a float; re-adding the
 * group as a floating group would tear down and rebuild its DOM, reloading
 * every iframe and video inside it. So we use `component.floatingGroups`, which
 * is TypeScript-private but a real runtime field.
 *
 * Everything here is shape-checked and returns a failure instead of throwing:
 * a dockview upgrade that moves these leaves the desktop with plain floating
 * windows (no snap, no maximise) rather than a broken client.
 */

export interface FloatingWindows {
  /** The window's current box, or `null` if it is not a float we can read. */
  boxOf(group: unknown): Box | null;
  /** Moves and resizes the window. Returns false when it could not be done. */
  position(group: unknown, box: Box): boolean;
  /** Fires when a float's drag ends — also after a *resize* drag, so gate on intent. */
  onDragEnd(handler: (group: unknown) => void): { dispose(): void };
  /** False when dockview no longer exposes what we need. */
  readonly available: boolean;
}

const UNAVAILABLE: FloatingWindows = {
  available: false,
  boxOf: () => null,
  position: () => false,
  onDragEnd: () => ({ dispose: () => void 0 }),
};

interface FloatEntry {
  readonly group: unknown;
  position(bounds: { top: number; left: number; width: number; height: number }): void;
  readonly overlay: { toJSON(): unknown };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** dockview's overlay serialises as an anchored box; we only ever use top/left. */
function boxFrom(raw: unknown): Box | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const x = num(b.left);
  const y = num(b.top);
  const width = num(b.width);
  const height = num(b.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

/** The floating-window operations of a live dockview, or a no-op stand-in. */
export function floatingWindows(api: unknown): FloatingWindows {
  const component = (api as any)?.component;
  const groups = component?.floatingGroups;
  if (!component || !Array.isArray(groups)) return UNAVAILABLE;
  if (typeof component.onDidEndFloatingGroupDrag !== "function") return UNAVAILABLE;

  const entryFor = (group: unknown): FloatEntry | null =>
    (component.floatingGroups as FloatEntry[]).find((f) => f?.group === group) ?? null;

  return {
    available: true,
    boxOf(group) {
      const entry = entryFor(group);
      if (!entry || typeof entry.overlay?.toJSON !== "function") return null;
      try {
        return boxFrom(entry.overlay.toJSON());
      } catch {
        return null;
      }
    },
    position(group, box) {
      const entry = entryFor(group);
      if (!entry || typeof entry.position !== "function") return false;
      try {
        // Always both anchors: the overlay flips which edge it is anchored to
        // depending on what it is given, and a flip would make restore drift.
        entry.position({ top: box.y, left: box.x, width: box.width, height: box.height });
        return true;
      } catch {
        return false;
      }
    },
    onDragEnd(handler) {
      try {
        const sub = component.onDidEndFloatingGroupDrag(handler);
        return { dispose: () => sub?.dispose?.() };
      } catch {
        return { dispose: () => void 0 };
      }
    },
  };
}

/**
 * The element dockview wraps a floating window in.
 *
 * Minimising toggles a class on it. It is deliberately not `setVisible(false)`:
 * that sets `display: none`, after which dockview re-clamps the window from its
 * now-zero bounding box on the next layout — parking it off-screen — and
 * serialises it as 0x0.
 */
export function overlayElementOf(group: { element?: unknown }): HTMLElement | null {
  const element = group?.element;
  if (!(element instanceof HTMLElement)) return null;
  return element.closest<HTMLElement>(".dv-resize-container");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w apps/web -- dockviewInternals`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck -w apps/web`

```bash
git add apps/web/src/dock/dockviewInternals.ts apps/web/src/dock/dockviewInternals.test.ts
git commit -m "feat: guarded adapter for dockview's floating-window internals

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Window operations

Rewrites `dockWindows.ts` around floating windows: open one, raise it, minimise it, maximise and restore it. This is the layer that applies the pure decisions to a live `DockviewApi`; it has no tests of its own (it is all dockview calls — the pure parts are already covered, and the gestures are covered by e2e in Task 13).

**Files:**

- Modify: `apps/web/src/dock/dockWindows.ts` (replace `summonWindow`, `revealPanel` and `panelSpots`; keep `installFloatOnDrop`)
- Delete: `apps/web/src/dock/summon.ts`, `apps/web/src/dock/summon.test.ts`

**Interfaces:**

- Consumes: `Box` from `./box`; `floatingWindows`, `overlayElementOf` from `./dockviewInternals` (Task 7); `WindowStates`, `setMinimized`, `setMaximized`, `isMaximized`, `stateOf` from `./windowState` (Task 5).
- Produces: `const MINIMIZED_CLASS = "dv-window-minimized"`, `interface WindowSpec { readonly component: string; readonly title: string; readonly params?: Record<string, unknown>; readonly box: Box }`, `function openWindow(api: DockviewApi, panelId: string, spec: WindowSpec): IDockviewPanel | null`, `function revealWindow(api: DockviewApi, panelId: string, states: WindowStates): WindowStates`, `function minimizeWindow(api: DockviewApi, panelId: string, states: WindowStates): WindowStates`, `function toggleMaximizeWindow(api: DockviewApi, panelId: string, desktop: DesktopSize, states: WindowStates): WindowStates`, `function applyMinimized(api: DockviewApi, states: WindowStates): void`, `function moveWindow(api: DockviewApi, panelId: string, box: Box): boolean`, plus the unchanged `installFloatOnDrop`.

- [ ] **Step 1: Delete the obsolete placement module**

`summon.ts`'s job was to find a grid anchor for a window coming back into a docked layout. There is no grid any more; `windowMeta.ts` (Task 2) took over the parts that still matter.

```bash
git rm apps/web/src/dock/summon.ts apps/web/src/dock/summon.test.ts
```

- [ ] **Step 2: Rewrite `dockWindows.ts`**

Replace the whole file with:

```ts
import type { DockviewApi, IDockviewPanel } from "dockview-vue";
import type { Box, DesktopSize } from "./box";
import { floatBoxAt, floatTargetForDrop } from "./floatDrop";
import { floatingWindows, overlayElementOf } from "./dockviewInternals";
import { isMaximized, setMaximized, setMinimized, stateOf, type WindowStates } from "./windowState";

/**
 * The dockview-facing half of the desktop: opening a window, raising it,
 * minimising it, maximising it. The rules themselves are pure and live in
 * `placement.ts`, `snap.ts` and `windowState.ts`; this file only applies them
 * to a live `DockviewApi`.
 */

/** Marks a minimised window. See `overlayElementOf` for why it is not `setVisible`. */
export const MINIMIZED_CLASS = "dv-window-minimized";

/** How to create a window that is not in the layout yet. */
export interface WindowSpec {
  readonly component: string;
  readonly title: string;
  readonly params?: Record<string, unknown>;
  readonly box: Box;
}

/**
 * Opens a window as a floating group at `spec.box`.
 *
 * dockview does not make a panel added this way active, so opening is always
 * followed by an explicit activate — which is also what raises the window above
 * its siblings.
 */
export function openWindow(
  api: DockviewApi,
  panelId: string,
  spec: WindowSpec,
): IDockviewPanel | null {
  // Adding a panel whose id is taken throws, so an already-open window is only raised.
  if (api.getPanel(panelId)) return api.getPanel(panelId) ?? null;
  const panel = api.addPanel({
    id: panelId,
    component: spec.component,
    title: spec.title,
    params: spec.params,
    floating: {
      x: spec.box.x,
      y: spec.box.y,
      width: spec.box.width,
      height: spec.box.height,
    },
  });
  panel.api.setActive();
  return panel;
}

/** Un-minimises a window and brings it to the front. */
export function revealWindow(
  api: DockviewApi,
  panelId: string,
  states: WindowStates,
): WindowStates {
  const panel = api.getPanel(panelId);
  if (!panel) return states;
  const next = setMinimized(states, panelId, false);
  applyMinimized(api, next);
  panel.api.setActive();
  return next;
}

/** Hides a window, leaving its taskbar button behind. */
export function minimizeWindow(
  api: DockviewApi,
  panelId: string,
  states: WindowStates,
): WindowStates {
  if (!api.getPanel(panelId)) return states;
  const next = setMinimized(states, panelId, true);
  applyMinimized(api, next);
  return next;
}

/** Moves and resizes a window. Returns false when dockview would not let us. */
export function moveWindow(api: DockviewApi, panelId: string, box: Box): boolean {
  const group = api.getPanel(panelId)?.group;
  if (!group) return false;
  return floatingWindows(api).position(group, box);
}

/**
 * Fills the desktop with the window, or puts it back where it was.
 *
 * The box to come back to is ours to remember: dockview's own `maximize()`
 * returns without doing anything for a floating group.
 */
export function toggleMaximizeWindow(
  api: DockviewApi,
  panelId: string,
  desktop: DesktopSize,
  states: WindowStates,
): WindowStates {
  const panel = api.getPanel(panelId);
  const group = panel?.group;
  if (!panel || !group) return states;
  const windows = floatingWindows(api);
  if (isMaximized(states, panelId)) {
    const restore = stateOf(states, panelId).restore;
    if (restore) windows.position(group, restore);
    return setMaximized(states, panelId, null);
  }
  const current = windows.boxOf(group);
  const full = { x: 0, y: 0, width: desktop.width, height: desktop.height };
  if (!windows.position(group, full)) return states;
  panel.api.setActive();
  return setMaximized(states, panelId, current);
}

/** Puts the minimised class on exactly the windows that are minimised. */
export function applyMinimized(api: DockviewApi, states: WindowStates): void {
  for (const panel of api.panels) {
    const element = panel.group ? overlayElementOf(panel.group) : null;
    if (!element) continue;
    element.classList.toggle(MINIMIZED_CLASS, stateOf(states, panel.id).minimized);
  }
}

/**
 * Makes a tab dropped on the centre of a window's content tear out into its own
 * window instead of joining that window. `dockElement` is the dock's root;
 * floating windows are positioned inside its `.dv-dockview` grid.
 *
 * With no grid to dock into, this is the only way to un-stack a tab, so it
 * stays exactly as it was.
 */
export function installFloatOnDrop(
  api: DockviewApi,
  dockElement: () => HTMLElement | null,
): { dispose(): void } {
  return api.onWillDrop((event) => {
    const target = floatTargetForDrop(
      { kind: event.kind, position: event.position, data: event.getData() },
      api.id,
    );
    const root = dockElement();
    if (!target || !root) return;
    const item =
      target.type === "panel"
        ? api.getPanel(target.panelId)
        : api.groups.find((g) => g.id === target.groupId);
    if (!item) return;
    event.preventDefault();
    const host = root.querySelector<HTMLElement>(".dv-dockview") ?? root;
    const rect = host.getBoundingClientRect();
    const { x, y, width, height } = floatBoxAt(
      event.nativeEvent.clientX - rect.left,
      event.nativeEvent.clientY - rect.top,
      rect.width,
      rect.height,
    );
    api.addFloatingGroup(item, { x, y, width, height });
    if (target.type === "panel") api.getPanel(target.panelId)?.api.setActive();
  });
}
```

- [ ] **Step 3: Run the suite to see what still refers to the deleted module**

Run: `npm run typecheck -w apps/web`
Expected: FAIL, and the errors should name only `App.vue` and `WindowBar.vue` (both are replaced in Tasks 10 and 11) — `Cannot find module './dock/summon'` and `summonWindow` / `revealPanel` no longer exported. That is the expected intermediate state; do not patch `App.vue` here.

- [ ] **Step 4: Run the tests that do not depend on the shell**

Run: `npm test -w apps/web`
Expected: PASS — the deleted `summon.test.ts` is gone and nothing else imported it.

- [ ] **Step 5: Commit**

The tree does not typecheck between this task and Task 11; commit it anyway so the rewrite stays reviewable in pieces, and say so in the message.

```bash
git add -A apps/web/src/dock
git commit -m "refactor: window operations for a floating desktop

Replaces the grid-anchor placement in summon.ts. App.vue still refers to the
old API and is rewired in a later commit, so the tree does not typecheck yet.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The desktop composable

Owns the live `DockviewApi` and everything stateful about the desktop: window state, the taskbar's buttons, the snap drag, persistence, and the starter desktop. This is the code that leaves `App.vue`.

**Files:**

- Create: `apps/web/src/dock/useDesktop.ts`

**Interfaces:**

- Consumes: everything from Tasks 1-8.
- Produces:

```ts
interface Desktop {
  readonly api: ShallowRef<DockviewApi | null>;
  readonly buttons: ComputedRef<readonly TaskbarButton[]>;
  readonly snapPreview: ShallowRef<Box | null>;
  readonly dragTransform: (context: unknown) => { top: number; left: number } | void;
  attach(api: DockviewApi): void;
  openWindow(panelId: string, spec: WindowSpec2): void;
  clickTaskbar(button: TaskbarButton): void;
  reveal(panelId: string): void;
  minimize(panelId: string): void;
  toggleMaximize(panelId: string): void;
  forget(panelId: string): void;
  resetDesktop(build: (api: DockviewApi) => void): void;
  saveLayout(): void;
  desktopSize(): DesktopSize | null;
  nextCascade(): number;
}
interface WindowSpec2 {
  readonly component: string;
  readonly title: string;
  readonly params?: Record<string, unknown>;
}
function useDesktop(): Desktop;
```

- [ ] **Step 1: Write the composable**

Create `apps/web/src/dock/useDesktop.ts`:

```ts
import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import type { DockviewApi } from "dockview-vue";
import { usableDesktop, type Box, type DesktopSize } from "./box";
import { cascadeBox } from "./placement";
import { snapBox, snapZoneFor, type SnapZone } from "./snap";
import { taskbarButtons, taskbarAction, type TaskbarButton } from "./taskbar";
import {
  forgetWindow,
  NO_WINDOWS,
  parseStates,
  pruneStates,
  serializeStates,
  type WindowStates,
} from "./windowState";
import {
  applyMinimized,
  minimizeWindow,
  moveWindow,
  openWindow,
  revealWindow,
  toggleMaximizeWindow,
} from "./dockWindows";
import { floatingWindows } from "./dockviewInternals";

/**
 * The desktop's state: which windows are minimised or maximised, what the
 * taskbar shows, the snap preview, and where all of it is saved.
 *
 * `App.vue` keeps only the shell and hands store signals in; everything that
 * talks to dockview lives here or in `dockWindows.ts`.
 */

/** Where dockview's own layout is saved. v4: floating windows, not a grid. */
export const LAYOUT_KEY = "jinz.dock.layout.v4";
/** Minimised / maximised state, which dockview does not serialise for floats. */
export const WINDOW_STATE_KEY = "jinz.dock.windows.v1";
/** Keys of the docked shell, deleted on first run of the desktop. */
const RETIRED_KEYS = ["jinz.dock.layout.v3", "jinz.dock.videoSeen", "jinz.dock.musicSeen"];
/** How long after a change the layout is written. */
const SAVE_DELAY_MS = 400;
/** The CSS selector of the dock's root element. */
const DOCK_SELECTOR = ".dock";

export interface WindowSpec2 {
  readonly component: string;
  readonly title: string;
  readonly params?: Record<string, unknown>;
}

export interface Desktop {
  readonly api: ShallowRef<DockviewApi | null>;
  readonly buttons: ComputedRef<readonly TaskbarButton[]>;
  readonly snapPreview: ShallowRef<Box | null>;
  readonly dragTransform: (context: unknown) => { top: number; left: number } | void;
  attach(api: DockviewApi): void;
  openWindow(panelId: string, spec: WindowSpec2): void;
  clickTaskbar(button: TaskbarButton): void;
  reveal(panelId: string): void;
  minimize(panelId: string): void;
  toggleMaximize(panelId: string): void;
  forget(panelId: string): void;
  resetDesktop(build: (api: DockviewApi) => void): void;
  saveLayout(): void;
  desktopSize(): DesktopSize | null;
  nextCascade(): number;
}

export function useDesktop(): Desktop {
  const api = shallowRef<DockviewApi | null>(null);
  const states = shallowRef<WindowStates>(NO_WINDOWS);
  /** Bumped by dockview's events so the taskbar recomputes. */
  const layoutTick = shallowRef(0);
  const snapPreview = shallowRef<Box | null>(null);
  let armed: SnapZone | null = null;
  let armedGroup: unknown = null;
  let opened = 0;
  let savingTimer: number | null = null;

  const buttons = computed(() => {
    void layoutTick.value;
    const live = api.value;
    if (!live) return [];
    const panels = live.panels.map((p) => ({ id: p.id, title: p.title ?? p.id }));
    const activeId = live.activePanel?.id ?? null;
    return taskbarButtons(panels, activeId, states.value);
  });

  function desktopSize(): DesktopSize | null {
    const root = document.querySelector<HTMLElement>(DOCK_SELECTOR);
    if (!root) return null;
    return usableDesktop(root.clientWidth, root.clientHeight);
  }

  function nextCascade(): number {
    return opened++;
  }

  function saveLayout(): void {
    const live = api.value;
    if (!live) return;
    if (savingTimer !== null) window.clearTimeout(savingTimer);
    savingTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(live.toJSON()));
        const pruned = pruneStates(
          states.value,
          live.panels.map((p) => p.id),
        );
        states.value = pruned;
        localStorage.setItem(WINDOW_STATE_KEY, serializeStates(pruned));
      } catch {
        /* ignore quota errors */
      }
    }, SAVE_DELAY_MS);
  }

  /** Runs an operation that returns the next window state, then saves. */
  function apply(next: (live: DockviewApi) => WindowStates): void {
    const live = api.value;
    if (!live) return;
    states.value = next(live);
    layoutTick.value++;
    saveLayout();
  }

  function attach(live: DockviewApi): void {
    api.value = live;
    for (const key of RETIRED_KEYS) localStorage.removeItem(key);
    states.value = parseStates(localStorage.getItem(WINDOW_STATE_KEY));
    // `api.panels` is a plain array, not reactive, so the taskbar only
    // recomputes because dockview's own events bump this counter.
    const resync = () => void layoutTick.value++;
    live.onDidAddPanel(resync);
    live.onDidRemovePanel(resync);
    live.onDidActivePanelChange(resync);
    live.onDidLayoutFromJSON(resync);
    live.onDidLayoutChange(resync);
    // A snap is committed when the float's drag ends. The same event fires
    // after a *resize* drag, so it only acts when a zone was actually armed.
    floatingWindows(live).onDragEnd((group) => {
      const zone = armed;
      const sameGroup = group === armedGroup;
      armed = null;
      armedGroup = null;
      snapPreview.value = null;
      if (!zone || !sameGroup) return;
      const size = desktopSize();
      const panel = live.panels.find((p) => p.group === group);
      if (!size || !panel) return;
      // Moving a window this way does not fire a layout change, so save here.
      if (moveWindow(live, panel.id, snapBox(zone, size))) saveLayout();
    });
  }

  /**
   * dockview's per-frame hook while a floating window is dragged. It arms a
   * snap zone and draws the preview; the box itself is left alone, so the
   * window follows the pointer until it is dropped, as Windows does.
   */
  function dragTransform(context: unknown): void {
    const ctx = context as {
      group?: unknown;
      proposed?: Box;
      container?: DesktopSize;
      modifiers?: { alt?: boolean };
    };
    const proposed = ctx?.proposed;
    const container = ctx?.container;
    if (!proposed || !container) return;
    const zone = snapZoneFor({
      box: proposed,
      desktop: container,
      current: armed,
      suspended: ctx.modifiers?.alt === true,
    });
    armed = zone;
    armedGroup = zone ? ctx.group : null;
    snapPreview.value = zone ? snapBox(zone, container) : null;
  }

  return {
    api,
    buttons,
    snapPreview,
    dragTransform,
    attach,
    desktopSize,
    nextCascade,
    saveLayout,
    openWindow(panelId, spec) {
      const live = api.value;
      if (!live) return;
      if (live.getPanel(panelId)) {
        this.reveal(panelId);
        return;
      }
      const size = desktopSize();
      if (!size) return;
      openWindow(live, panelId, { ...spec, box: cascadeBox(nextCascade(), size) });
      apply((api2) => {
        applyMinimized(api2, states.value);
        return states.value;
      });
    },
    clickTaskbar(button) {
      if (taskbarAction(button) === "minimize") this.minimize(button.panelId);
      else this.reveal(button.panelId);
    },
    reveal(panelId) {
      apply((live) => revealWindow(live, panelId, states.value));
    },
    minimize(panelId) {
      apply((live) => minimizeWindow(live, panelId, states.value));
    },
    toggleMaximize(panelId) {
      const size = desktopSize();
      if (!size) return;
      apply((live) => toggleMaximizeWindow(live, panelId, size, states.value));
    },
    forget(panelId) {
      apply(() => forgetWindow(states.value, panelId));
    },
    resetDesktop(build) {
      const live = api.value;
      if (!live) return;
      localStorage.removeItem(LAYOUT_KEY);
      localStorage.removeItem(WINDOW_STATE_KEY);
      states.value = NO_WINDOWS;
      opened = 0;
      live.clear();
      build(live);
      saveLayout();
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: the only remaining errors are `App.vue` and `WindowBar.vue` still importing the deleted `./dock/summon`. If `useDesktop.ts` itself reports errors, fix them before moving on.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/dock/useDesktop.ts
git commit -m "feat: the desktop composable

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Desktop, taskbar and window controls

The three components and their strings. `Desktop.vue` goes in dockview's watermark slot — the component dockview renders when its grid holds no panels, which is permanently our case, and which sits in a DOM layer _below_ the floating windows, so icons can never cover a window.

**Files:**

- Create: `apps/web/src/dock/Desktop.vue`, `apps/web/src/dock/DesktopIcon.vue`, `apps/web/src/dock/Taskbar.vue`, `apps/web/src/dock/SnapOverlay.vue`, `apps/web/src/dock/desktop.css`
- Modify: `apps/web/src/dock/HeaderActions.vue`, `apps/web/src/i18n/zh-CN.ts`, `apps/web/src/i18n/en.ts`
- Delete: `apps/web/src/dock/WindowBar.vue`

- [ ] **Step 1: Add the strings to both catalogues**

In `apps/web/src/i18n/zh-CN.ts`, replace the `dock.*` block (currently `dock.float` through `dock.reopenWindow`) with:

```ts
  "dock.floatHere": "松开以浮动",
  "dock.closeGroup": "关闭这一组的全部标签（桌面图标可重新打开）",
  "dock.windows": "窗口",
  "dock.showWindow": "显示「{name}」窗口",
  "dock.reopenWindow": "重新打开「{name}」窗口",
  "dock.minimize": "最小化",
  "dock.maximize": "最大化",
  "dock.restore": "还原",
  "desktop.label": "桌面",
  "desktop.open": "打开「{name}」",
```

In `apps/web/src/i18n/en.ts`, the same keys:

```ts
  "dock.floatHere": "Release to float",
  "dock.closeGroup": "Close every tab in this window (its desktop icon reopens it)",
  "dock.windows": "Windows",
  "dock.showWindow": "Show the {name} window",
  "dock.reopenWindow": "Reopen the {name} window",
  "dock.minimize": "Minimise",
  "dock.maximize": "Maximise",
  "dock.restore": "Restore",
  "desktop.label": "Desktop",
  "desktop.open": "Open {name}",
```

`dock.float` is gone from both: it labelled the button that docked a window into the grid, and there is no grid.

- [ ] **Step 2: Typecheck to prove the catalogues still agree**

Run: `npm run typecheck -w apps/web`
Expected: no _new_ errors about `Messages`. `en.ts` is typed as `Messages` (= `typeof zhCN`), so a key in one catalogue and not the other fails here. Errors about `./dock/summon` in `App.vue` / `WindowBar.vue` are still expected.

- [ ] **Step 3: Write the desktop icon**

Create `apps/web/src/dock/DesktopIcon.vue`:

```vue
<script setup lang="ts">
import { useI18n } from "../i18n";
import { WINDOW_META, type WindowId } from "./windowMeta";

/**
 * One desktop icon. Click selects it, double-click (or Enter / Space on a
 * focused icon) opens its window — the Windows gesture, and the keyboard one
 * a double-click alone would leave out.
 */
defineProps<{ id: WindowId; selected: boolean }>();
const emit = defineEmits<{ select: [id: WindowId]; open: [id: WindowId] }>();
const { t } = useI18n();
</script>

<template>
  <button
    class="desk-icon"
    :class="{ selected }"
    type="button"
    data-testid="desktop-icon"
    :data-window="id"
    :title="t('desktop.open', { name: t(WINDOW_META[id].key) })"
    @click="emit('select', id)"
    @dblclick="emit('open', id)"
    @keydown.enter.prevent="emit('open', id)"
    @keydown.space.prevent="emit('open', id)"
  >
    <span class="glyph" aria-hidden="true">{{ WINDOW_META[id].icon }}</span>
    <span class="label">{{ t(WINDOW_META[id].key) }}</span>
  </button>
</template>
```

- [ ] **Step 4: Write the desktop**

Create `apps/web/src/dock/Desktop.vue`:

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../i18n";
import DesktopIcon from "./DesktopIcon.vue";
import type { WindowId } from "./windowMeta";

/**
 * The desktop: dockview's watermark slot, which it renders whenever the grid
 * holds no panels — permanently, here, because nothing ever docks into it.
 * Icons therefore sit below the floating windows in dockview's own layering.
 *
 * dockview hands watermark components a `params` prop; the desktop is driven
 * by its own props, so `inheritAttrs` is off to keep it off the DOM.
 */
defineOptions({ inheritAttrs: false });
defineProps<{ icons: readonly WindowId[] }>();
const emit = defineEmits<{ open: [id: WindowId] }>();
const { t } = useI18n();
const selected = ref<WindowId | null>(null);
</script>

<template>
  <div
    class="desktop"
    data-testid="desktop"
    role="group"
    :aria-label="t('desktop.label')"
    @click.self="selected = null"
  >
    <div class="icons">
      <DesktopIcon
        v-for="id in icons"
        :key="id"
        :id="id"
        :selected="selected === id"
        @select="selected = $event"
        @open="emit('open', $event)"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 5: Write the taskbar**

Create `apps/web/src/dock/Taskbar.vue`. It keeps the `window-bar` class, which both theme skins style as `.window-bar.glass-host` and three e2e specs reach for.

```vue
<script setup lang="ts">
import { useI18n } from "../i18n";
import type { TaskbarButton } from "./taskbar";

/**
 * The taskbar: one button per open window, the way Windows does it. A closed
 * window has no button — its desktop icon opens it again.
 */
defineProps<{ buttons: readonly TaskbarButton[] }>();
const emit = defineEmits<{ activate: [button: TaskbarButton]; close: [panelId: string] }>();
const { t } = useI18n();
</script>

<template>
  <nav class="window-bar glass-host" :aria-label="t('dock.windows')">
    <button
      v-for="button in buttons"
      :key="button.panelId"
      class="task-btn"
      :class="{ active: button.active, minimized: button.minimized }"
      :aria-pressed="button.active"
      data-testid="taskbar-button"
      :data-panel="button.panelId"
      :title="t('dock.showWindow', { name: button.title })"
      @click="emit('activate', button)"
      @contextmenu.prevent="emit('close', button.panelId)"
    >
      <span class="task-icon" aria-hidden="true">{{ button.icon }}</span>
      <span class="task-label">{{ button.title }}</span>
    </button>
  </nav>
</template>
```

- [ ] **Step 6: Write the snap preview**

Create `apps/web/src/dock/SnapOverlay.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import type { Box } from "./box";

/** The translucent rectangle showing where a dragged window would land. */
const props = defineProps<{ box: Box | null }>();
const style = computed(() =>
  props.box
    ? {
        left: `${props.box.x}px`,
        top: `${props.box.y}px`,
        width: `${props.box.width}px`,
        height: `${props.box.height}px`,
      }
    : undefined,
);
</script>

<template>
  <div
    v-if="box"
    class="snap-preview"
    data-testid="snap-preview"
    :style="style"
    aria-hidden="true"
  />
</template>
```

- [ ] **Step 7: Give the window its controls**

Replace `apps/web/src/dock/HeaderActions.vue` with:

```vue
<script setup lang="ts">
import type { DockviewApi, DockviewGroupPanel } from "dockview-vue";
import { useI18n } from "../i18n";

/**
 * A window's controls, in the right-hand header actions dockview gives every
 * group: minimise, maximise / restore, close — the Windows three.
 *
 * dockview constructs this component itself, so its buttons cannot be bound to
 * a parent's handlers. Close is the group's own api; minimise and maximise are
 * plain buttons that `App.vue` picks up by delegation from the dock element,
 * because only the desktop knows a floating window's state.
 */
const props = defineProps<{
  params: { containerApi: DockviewApi; group: DockviewGroupPanel; isGroupActive: boolean };
}>();

const { t } = useI18n();

/** Closes every tab in this window at once; the desktop icon brings it back. */
function closeGroup(): void {
  props.params.group?.api.close();
}
</script>

<template>
  <div class="hdr-actions">
    <button
      class="hdr-btn"
      :title="t('dock.minimize')"
      :aria-label="t('dock.minimize')"
      data-testid="dock-minimize"
    >
      —
    </button>
    <button
      class="hdr-btn"
      :title="t('dock.maximize')"
      :aria-label="t('dock.maximize')"
      data-testid="dock-maximize"
    >
      □
    </button>
    <button
      class="hdr-btn"
      :title="t('dock.closeGroup')"
      :aria-label="t('dock.closeGroup')"
      data-testid="dock-close-group"
      @click="closeGroup"
    >
      ✕
    </button>
  </div>
</template>

<style scoped>
.hdr-actions {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 6px;
}
.hdr-btn {
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 6px;
}
.hdr-btn:hover {
  background: var(--bg-elev-2);
  color: var(--text);
}
.hdr-btn[data-testid="dock-close-group"]:hover {
  color: var(--danger);
}
</style>
```

- [ ] **Step 8: Write the desktop stylesheet**

Create `apps/web/src/dock/desktop.css`. It is a plain stylesheet rather than scoped styles because the minimised class lands on an element dockview owns.

```css
/*
 * The desktop surface, its icons, the taskbar and the snap preview.
 *
 * Not scoped: `.dv-window-minimized` is put on dockview's own floating-window
 * wrapper, which a scoped stylesheet could not reach.
 */

.desktop {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.desktop .icons {
  display: flex;
  flex-direction: column;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 4px;
  padding: 10px;
  height: 100%;
}
.desk-icon {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 92px;
  padding: 8px 4px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  text-align: center;
  cursor: pointer;
}
.desk-icon:hover {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}
.desk-icon.selected {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  border-color: var(--accent);
}
.desk-icon:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
.desk-icon .glyph {
  font-size: 26px;
  line-height: 1.1;
}
.desk-icon .label {
  font-size: 11px;
  line-height: 1.3;
  overflow-wrap: anywhere;
  text-shadow: 0 1px 2px rgb(0 0 0 / 55%);
}

/* A minimised window keeps its box, so dockview can still measure it. */
.dv-window-minimized {
  visibility: hidden;
  pointer-events: none;
}

.snap-preview {
  position: absolute;
  z-index: 2;
  border: 2px solid var(--accent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  pointer-events: none;
}

.window-bar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elev);
  overflow-x: auto;
  scrollbar-width: none;
  min-height: 26px;
}
.task-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 180px;
  padding: 2px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--bg-elev-2);
  color: var(--text-dim);
  font-size: 12px;
  line-height: 18px;
}
.task-btn:hover {
  border-color: var(--border);
  color: var(--text);
}
.task-btn.active {
  border-color: var(--accent);
  color: var(--text);
}
.task-btn.minimized {
  background: transparent;
  opacity: 0.65;
}
.task-btn .task-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-btn:focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}
```

- [ ] **Step 9: Remove the old bar**

```bash
git rm apps/web/src/dock/WindowBar.vue
```

- [ ] **Step 10: Commit**

`App.vue` is still unwired, so the tree still does not typecheck; Task 11 closes that.

```bash
git add -A apps/web/src/dock apps/web/src/i18n
git commit -m "feat: desktop, taskbar, window controls and their strings

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Wire up the shell

Rewires `App.vue` onto the desktop and takes the auto-opening watchers out of it. After this task the client runs.

**Files:**

- Create: `apps/web/src/dock/useAutoWindows.ts`
- Modify: `apps/web/src/App.vue`
- Modify: `apps/web/src/dock/panels.ts`
- Modify: `apps/web/src/theme/skins/needy.css`, `apps/web/src/theme/skins/ame.css`
- Delete: `apps/web/src/dock/layout.ts`, `apps/web/src/dock/layout.test.ts`

- [ ] **Step 1: Delete the grid sizer**

Its ratios now live in `placement.ts`, and its null-guard became `usableDesktop` in `box.ts`, both with their own tests.

```bash
git rm apps/web/src/dock/layout.ts apps/web/src/dock/layout.test.ts
```

- [ ] **Step 2: Move the auto-opening watchers out of `App.vue`**

Create `apps/web/src/dock/useAutoWindows.ts`. This is `App.vue`'s `ensureChatPanel` / `ensureVideoPanel` / `ensureMusicPanel` and their watchers, unchanged in behaviour except that windows are opened through the desktop, and a conversation that opens in the background opens minimised so it does not jump onto the desktop.

```ts
import { computed, watch } from "vue";
import { locale, t } from "../i18n";
import { useTsStore } from "../stores/ts";
import { useMusicStore } from "../stores/music";
import { useRtcStore } from "../stores/rtc";
import { useFileBrowserStore } from "../stores/fileBrowser";
import { conversationName } from "../ts/conversationName";
import { CHAT_PREFIX, WINDOW_META, windowPanelId, type WindowId } from "./windowMeta";
import type { Desktop } from "./useDesktop";

/**
 * The windows the client opens by itself: a conversation you are sent a message
 * in, the video when someone shares, the music panel when a bot answers.
 *
 * A window opened in the background opens minimised — it appears in the taskbar
 * without a window jumping onto the desktop mid-sentence.
 */
export function useAutoWindows(desktop: Desktop): {
  chatTitle(conv: string): string;
  titleOf(id: WindowId): string;
  openWindow(id: WindowId): void;
  openConversation(conv: string, activate: boolean): void;
} {
  const ts = useTsStore();
  const music = useMusicStore();
  const rtc = useRtcStore();
  const fileBrowser = useFileBrowserStore();

  function chatTitle(conv: string): string {
    const name = conversationName(conv, ts);
    const unread = ts.unread.get(conv) ?? 0;
    return unread ? `${name} (${unread})` : name;
  }

  function titleOf(id: WindowId): string {
    return id === "chat" ? chatTitle("server") : t(WINDOW_META[id].key);
  }

  /** Opens (or raises) a conversation's window. */
  function openConversation(conv: string, activate: boolean): void {
    const panelId = CHAT_PREFIX + conv;
    const live = desktop.api.value;
    if (!live) return;
    if (live.getPanel(panelId)) {
      if (activate) desktop.reveal(panelId);
      return;
    }
    desktop.openWindow(panelId, {
      component: "chat",
      title: chatTitle(conv),
      params: { conversation: conv },
    });
    if (!activate) desktop.minimize(panelId);
  }

  /** Opens (or raises) one of the desktop's windows. */
  function openWindow(id: WindowId): void {
    const panelId = windowPanelId(id);
    if (id === "chat") {
      openConversation("server", true);
      return;
    }
    desktop.openWindow(panelId, { component: id, title: titleOf(id) });
  }

  function refreshChatTitles(): void {
    const live = desktop.api.value;
    if (!live) return;
    for (const p of live.panels) {
      if (!p.id.startsWith(CHAT_PREFIX)) continue;
      const title = chatTitle(p.id.slice(CHAT_PREFIX.length));
      if (p.title !== title) p.setTitle(title);
    }
  }

  /** Static windows are titled once at creation, so retitle on a language change. */
  watch(locale, () => {
    const live = desktop.api.value;
    if (!live) return;
    for (const id of ["tree", "video", "info", "music", "apps", "sounds", "files"] as const) {
      live.getPanel(windowPanelId(id))?.setTitle(t(WINDOW_META[id].key));
    }
    refreshChatTitles();
  });

  watch(
    () => ts.activeConversation,
    (conv) => {
      openConversation(conv, true);
      refreshChatTitles();
    },
  );
  watch(
    () => ts.messages.length,
    () => {
      const last = ts.messages.at(-1);
      if (last && !last.self) openConversation(last.conversation, false);
      refreshChatTitles();
    },
  );
  watch(
    () => [...ts.unread.entries()].map(([k, v]) => `${k}=${v}`).join(","),
    () => refreshChatTitles(),
  );
  // Like TS3, open the chat of the channel you are in, in the background.
  watch(
    () => ts.selfChannel?.id,
    (id) => {
      if (id && ts.connState === "connected") openConversation(`channel:${id}`, false);
    },
  );

  // Someone started sharing, or the user asked to watch.
  watch(
    () => rtc.revealTick,
    () => {
      if (ts.features.video) openWindow("video");
    },
  );

  const wantMusic = computed(
    () => ts.features.music && (music.available || !!ts.profile.musicBot.trim()),
  );
  // The bot usually only answers after the desktop was built.
  watch(
    () => music.available,
    (on) => {
      if (on && wantMusic.value) openWindow("music");
    },
  );

  // "Browse files…" in a channel menu; the phone shell opens its sheet on the
  // same signal.
  watch(
    () => fileBrowser.openTick,
    () => openWindow("files"),
  );

  return { chatTitle, titleOf, openWindow, openConversation };
}
```

- [ ] **Step 3: Register the desktop as a dockview component**

In `apps/web/src/dock/panels.ts`, nothing changes: the desktop is passed to `<DockviewVue>` as `watermark-component`, not through `dockComponents`. Confirm the file is untouched.

- [ ] **Step 4: Rewire `App.vue`'s script**

In `apps/web/src/App.vue`:

Replace the dock imports (lines around 15-21) with:

```ts
import HeaderActions from "./dock/HeaderActions.vue";
import Taskbar from "./dock/Taskbar.vue";
import Desktop from "./dock/Desktop.vue";
import SnapOverlay from "./dock/SnapOverlay.vue";
import { installFloatOnDrop, openWindow as openFloatingWindow } from "./dock/dockWindows";
import { availableWindows } from "./dock/windowMeta";
import { useDesktop, LAYOUT_KEY } from "./dock/useDesktop";
import { useAutoWindows } from "./dock/useAutoWindows";
import { starterDesktop } from "./dock/placement";
import "./dock/floatHint.css";
import "./dock/desktop.css";
import { dockComponents } from "./dock/panels";
```

Delete these, which the desktop replaced: `defaultSizingPending`, `layoutKey`, `LATE_MUSIC_GRACE_MS`, `savingTimer`, `dockApi`, `dockApiRef`, `ensureChatPanel`, `STATIC_TITLES`, `refreshChatTitles`, `chatTitle`, the five chat/video/music watchers, `ensureVideoPanel`, `wantMusic`, `ensureMusicPanel`, `ColumnWidths`, `columnWidths`, `fitMusicColumn`, `FULL_LAYOUT`, `barWindows`, `onSummon`, the `fileBrowser` watcher, `applyDefaultProportions`, `buildDefaultLayout`, `saveLayout`. Keep everything about banners, `isMobile`, `dockComponentsRaw`, `headerActions` and `CHAT`.

Add in their place:

```ts
const desktop = useDesktop();
const auto = useAutoWindows(desktop);

/** Which icons the desktop shows depends on what the hub offers. */
const desktopIcons = computed(() =>
  availableWindows({
    video: ts.features.video,
    music: ts.features.music && (music.available || !!ts.profile.musicBot.trim()),
    files: !!ts.features.files,
  }),
);

/** The centre drop overlay says what it does; a CSS string, read by `content:`. */
const dockStyle = computed(() => ({ "--dock-float-hint": JSON.stringify(t("dock.floatHere")) }));

/**
 * Nothing docks into the grid: `false` disables the one drop target that can
 * create or split grid groups, which is what keeps the desktop uncovered.
 */
const dndEdges = false;

/** Opens the windows a new user starts with. */
function buildStarterDesktop(api: DockviewApi): void {
  const size = desktop.desktopSize();
  if (!size) return;
  const features = {
    video: ts.features.video,
    music: desktopIcons.value.includes("music"),
    files: !!ts.features.files,
  };
  for (const window of starterDesktop(features, size)) {
    openFloatingWindow(api, window.panelId, {
      component: window.id === "chat" ? "chat" : window.id,
      title: auto.titleOf(window.id),
      params: window.id === "chat" ? { conversation: "server" } : undefined,
      box: window.box,
    });
  }
}

function onReady(event: DockviewReadyEvent): void {
  const api = event.api;
  desktop.attach(api);
  // Dropping a tab on the middle of a window tears it out into its own window;
  // with no grid, that is the only way to un-stack one.
  installFloatOnDrop(api, () => document.querySelector<HTMLElement>(".dock"));
  // A drop on a window's content *edges* would split the window's own interior
  // into two panes, which is not a thing a desktop window does.
  api.onWillShowOverlay((overlay) => {
    if (overlay.kind === "content" && overlay.position !== "center") overlay.preventDefault();
  });
  const saved = localStorage.getItem(LAYOUT_KEY);
  let restored = false;
  if (saved) {
    try {
      api.fromJSON(JSON.parse(saved));
      // Private chats are keyed by client id, which the server reuses across
      // sessions, so a restored `chat:client:<id>` panel would point at whoever
      // holds that id now. Channel ids are per server too.
      for (const p of [...api.panels]) {
        const conv = p.id.startsWith(CHAT) ? p.id.slice(CHAT.length) : "";
        const staleClient = conv.startsWith("client:");
        const staleChannel =
          conv.startsWith("channel:") && !ts.channels.has(conv.slice("channel:".length));
        if (staleClient || staleChannel) api.removePanel(p);
      }
      restored = api.panels.length > 0;
    } catch {
      restored = false;
    }
  }
  if (!restored) buildStarterDesktop(api);
  // A layout saved against a hub that had a music bot keeps the window; without
  // one it can only ever say "unavailable", so drop it.
  if (restored && !desktopIcons.value.includes("music")) {
    const panel = api.getPanel("music");
    if (panel) api.removePanel(panel);
  }
  api.onDidLayoutChange(() => desktop.saveLayout());
  api.onDidRemovePanel((event) => desktop.forget(event.id));
  api.onDidActivePanelChange((e) => {
    const id = e.panel?.id;
    if (id?.startsWith(CHAT)) ts.openConversation(id.slice(CHAT.length));
  });
  // dockview computes pixel sizes at init; its container can still be 0-height
  // on the first frame, so force a re-layout once the flexbox has settled.
  const relayout = () => {
    const root = document.querySelector<HTMLElement>(".dock");
    if (root) api.layout(root.clientWidth, root.clientHeight, true);
  };
  requestAnimationFrame(relayout);
  setTimeout(relayout, 60);
}

function resetLayout(): void {
  desktop.resetDesktop(buildStarterDesktop);
}
```

Keep the existing `import { DockviewVue, type DockviewApi, type DockviewReadyEvent } from "dockview-vue";`.

- [ ] **Step 5: Rewire `App.vue`'s template**

Replace the `<WindowBar …/>` element with the taskbar, and give `<DockviewVue>` the desktop and the drag hook:

```vue
    <Taskbar
      v-if="ts.connState === 'connected' && !isMobile"
      :buttons="desktop.buttons.value"
      @activate="desktop.clickTaskbar($event)"
      @close="desktop.api.value?.getPanel($event)?.api.close()"
    />
    <div class="dock-wrap">
      <template v-if="ts.connState === 'connected'">
        <MobileShell v-if="isMobile" />
        <template v-else>
          <DockviewVue
            class="dock dockview-theme-abyss"
            :components="dockComponentsRaw"
            :right-header-actions-component="headerActions"
            :watermark-component="desktopComponent"
            :dnd-edges="dndEdges"
            :transform-floating-group-drag="desktop.dragTransform"
            :floating-group-drag-handle="'titlebar'"
            :style="dockStyle"
            @ready="onReady"
          />
          <SnapOverlay :box="desktop.snapPreview.value" />
        </template>
      </template>
```

dockview needs the watermark as a raw component, and the desktop's icons and its open handler come from this file, so wrap it next to `headerActions`:

```ts
const desktopComponent = markRaw(
  defineComponent({
    name: "DesktopWatermark",
    inheritAttrs: false,
    setup() {
      return () =>
        h(Desktop, { icons: desktopIcons.value, onOpen: (id: WindowId) => auto.openWindow(id) });
    },
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;
```

Add `defineComponent, h` to the `vue` import and `import type { WindowId } from "./dock/windowMeta";`.

`HeaderActions.vue`'s minimise and maximise are plain buttons (dockview constructs that component itself, so they cannot be bound to a handler here). Pick them up by delegation — add to `onReady`, after `installFloatOnDrop`:

```ts
// dockview constructs the header actions itself, so their events cannot be
// bound in the template; the two window controls are delegated here.
const root = document.querySelector<HTMLElement>(".dock");
root?.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
    "[data-testid=dock-minimize], [data-testid=dock-maximize]",
  );
  if (!button) return;
  const panelId = api.activePanel?.id;
  if (!panelId) return;
  if (button.dataset.testid === "dock-minimize") desktop.minimize(panelId);
  else desktop.toggleMaximize(panelId);
});
```

- [ ] **Step 6: Point the theme skins at the taskbar**

In `apps/web/src/theme/skins/needy.css` and `apps/web/src/theme/skins/ame.css`, the `.window-bar.glass-host` rules keep working (the class is unchanged). Add a desktop rule to each, next to the existing `.dock` block, so the desktop is not a blank slab:

```css
.desktop {
  background:
    radial-gradient(
      120% 100% at 50% 0%,
      color-mix(in srgb, var(--accent) 10%, transparent),
      transparent 70%
    ),
    var(--bg);
}
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w apps/web`
Expected: **no errors.** This is the first task since Task 8 where the tree typechecks; fix whatever it reports before going on.

- [ ] **Step 8: Run the unit suite**

Run: `npm test -w apps/web`
Expected: PASS, all files. The deleted `summon.test.ts` and `layout.test.ts` are gone; `box`, `windowMeta`, `placement`, `snap`, `windowState`, `taskbar`, `dockviewInternals` and `floatDrop` are green.

- [ ] **Step 9: Check `App.vue` shrank**

Run: `wc -l apps/web/src/App.vue`
Expected: well under the 741 it started at — the file should be around 450-500 lines. If it is longer, something that belonged in `useAutoWindows.ts` was left behind.

- [ ] **Step 10: Format and commit**

```bash
npm run format
git add -A apps/web/src
git commit -m "feat: run the shell on the Windows-style desktop

Taskbar of open windows, desktop icons in dockview's watermark slot, every
panel a floating window, nothing docks into the grid.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Verify it in a browser

The desktop is DOM behaviour that no unit test covers. Drive the real app once before touching the e2e specs, so Task 13 is written against something known to work.

**Files:** none — this is verification.

- [ ] **Step 1: Start the app**

Run: `npm run dev` from the repo root and connect to the test server (see the project's own notes for credentials).

- [ ] **Step 2: Walk the gestures, and write down what actually happens for each**

- The starter desktop opens tree / chat / info (+ video, music) as windows filling the screen in the old proportions.
- The taskbar shows one button per open window and **no** button for a window that is not open.
- Closing a window with ✕ removes its taskbar button; its desktop icon is still there.
- Double-clicking a desktop icon opens that window; double-clicking it again raises the existing one rather than opening a second.
- **—** hides the window, its taskbar button stays and dims, clicking the button brings it back at the same size and position.
- **□** fills the desktop; **□** again returns it to exactly its previous box.
- Dragging a window's titlebar to the left edge shows the preview and drops it into the left half; the corners give quarters; the top edge fills the desktop.
- Holding Alt while dragging to an edge shows no preview and drops the window where the pointer is.
- Dragging a tab onto another window's tab bar stacks them; dragging it onto that window's centre tears it out again.
- No drag can cover the desktop icons with a docked pane.
- Reloading the page brings every window back where it was, including which were minimised.
- The status bar's ⊞ button rebuilds the starter desktop.
- Narrowing the window below the mobile breakpoint still shows the phone shell, with no taskbar.

- [ ] **Step 3: Fix what does not work, then re-verify**

The likeliest failures and where they live: minimise not hiding (the class lands on the wrong element — `overlayElementOf` in `dockviewInternals.ts`); maximise doing nothing (`floatingWindows(api).available` is false, meaning dockview moved `component.floatingGroups`); the snap preview never appearing (`transform-floating-group-drag` is not being passed, or is being passed after the first window was created — it is captured per float at creation).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A apps/web/src
git commit -m "fix: <what the browser showed>

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Migrate the end-to-end specs

The Playwright specs are the only automated coverage of the shell's DOM. Four of them reach for the old bar and the old chat tabs.

**Files:**

- Modify: `scripts/e2e/lib/rig.mjs`, `scripts/e2e/specs/apps-panel.spec.mjs`, `scripts/e2e/specs/soundboard.spec.mjs`, `scripts/e2e/specs/m3-file-browser.spec.mjs`, `scripts/e2e/specs/settings-panel.spec.mjs`
- Create: `scripts/e2e/specs/desktop.spec.mjs`

- [ ] **Step 1: Teach the rig the taskbar and the desktop**

In `scripts/e2e/lib/rig.mjs`, replace `openChat` (around line 288) and add an icon helper next to it:

```js
  /** Brings a chat window to the front from its taskbar button. */
  async openChat(page, title) {
    const button = page
      .locator("[data-testid=taskbar-button]")
      .filter({ hasText: title })
      .first();
    await button.waitFor({ state: "visible", timeout: 15_000 });
    await button.click();
    const panel = page
      .locator("section.chat")
      .filter({ has: page.locator(".title", { hasText: title }) });
    await panel.first().waitFor({ state: "visible", timeout: 10_000 });
    return panel.first();
  }

  /** Opens a window from its desktop icon, the way a user does. */
  async openFromDesktop(page, windowId) {
    const icon = page.locator(`[data-testid=desktop-icon][data-window=${windowId}]`);
    await icon.waitFor({ state: "visible", timeout: 15_000 });
    await icon.dblclick();
  }
```

`sendChannelMessage` and `waitForChatMessage` call `openChat` and need no change — this is the single point the chat specs go through.

- [ ] **Step 2: Point the three window-bar specs at desktop icons**

In `scripts/e2e/specs/apps-panel.spec.mjs`, replace `openApps`:

```js
async function openApps(page, rig) {
  await rig.openFromDesktop(page, "apps");
  await page.locator(".apps").waitFor();
}
```

and update its two call sites to pass `rig`. Its close-and-reopen check at the end still uses `dock-close-group`, which kept its testid; update the comment to say the desktop icon reopens it.

In `scripts/e2e/specs/soundboard.spec.mjs` (around line 40) replace the window-bar click with `await rig.openFromDesktop(page, "sounds")`, and in `scripts/e2e/specs/m3-file-browser.spec.mjs` (around line 183) with `await rig.openFromDesktop(page, "files")`, adjusting the surrounding comment that mentions "the window bar".

- [ ] **Step 3: Re-point the reset-layout assertion**

In `scripts/e2e/specs/settings-panel.spec.mjs` (around line 60), after clicking `status-reset-layout`, assert the starter desktop came back rather than that a particular docked pane exists:

```js
await page.getByTestId("status-reset-layout").click();
await page.locator(".tree").waitFor({ state: "visible", timeout: 10_000 });
await page
  .locator("[data-testid=taskbar-button]")
  .first()
  .waitFor({ state: "visible", timeout: 10_000 });
```

- [ ] **Step 4: Write the desktop spec**

Create `scripts/e2e/specs/desktop.spec.mjs`:

```js
/**
 * The desktop shell: a window opens from its icon, lives in the taskbar, and
 * minimises, restores and snaps the way a Windows window does.
 */
import assert from "node:assert/strict";

export const title = "desktop: icons open windows, the taskbar tracks them, edges snap";

const taskbarFor = (page, panelId) =>
  page.locator(`[data-testid=taskbar-button][data-panel="${panelId}"]`);

export default async function desktop(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;

  // The starter desktop is up: the tree is a window, and it has a taskbar button.
  await page.locator(".tree").waitFor({ state: "visible" });
  await taskbarFor(page, "tree").waitFor({ state: "visible" });

  // A window the starter desktop does not open has an icon but no button.
  assert.equal(await taskbarFor(page, "sounds").count(), 0, "soundboard starts closed");
  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor({ state: "visible" });
  await taskbarFor(page, "sounds").waitFor({ state: "visible" });

  // Minimise: the window goes, the button stays.
  const soundboard = page.locator(".dv-groupview", { has: page.locator(".soundboard") });
  await soundboard.getByTestId("dock-minimize").click();
  await page.locator(".soundboard").waitFor({ state: "hidden" });
  await taskbarFor(page, "sounds").waitFor({ state: "visible" });

  // The taskbar button brings it back.
  await taskbarFor(page, "sounds").click();
  await page.locator(".soundboard").waitFor({ state: "visible" });

  // Snap it to the left half by dragging its titlebar to the left edge.
  const dock = await page.locator(".dock").boundingBox();
  const handle = await soundboard
    .locator(".dv-floating-titlebar, .dv-tabs-container")
    .first()
    .boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(dock.x + 4, dock.y + dock.height / 2, { steps: 20 });
  await page.locator("[data-testid=snap-preview]").waitFor({ state: "visible" });
  await page.mouse.up();
  const snapped = await soundboard.boundingBox();
  assert.ok(
    Math.abs(snapped.width - dock.width / 2) < 24,
    `snapped window should take half the desktop, took ${snapped.width} of ${dock.width}`,
  );

  // Closing it takes its button away; the icon is still there to reopen it.
  await soundboard.getByTestId("dock-close-group").click();
  await page.locator(".soundboard").waitFor({ state: "detached" });
  assert.equal(await taskbarFor(page, "sounds").count(), 0, "a closed window leaves the taskbar");
  await rig.openFromDesktop(page, "sounds");
  await page.locator(".soundboard").waitFor({ state: "visible" });
}
```

- [ ] **Step 5: Register the spec if the runner needs it**

Run: `sed -n '1,60p' scripts/e2e/run.mjs` and check whether specs are discovered from the directory or listed. If they are listed, add `desktop.spec.mjs` to the list.

- [ ] **Step 6: Run the affected specs**

Run: `npm run e2e` (needs the TeamSpeak test server up).
Expected: PASS, including `desktop`, `apps-panel`, `soundboard`, `m3-file-browser`, `settings-panel` and every chat-using spec that goes through `openChat`.

If the drag in step 4 does not produce a snap, check the drag handle selector against the real DOM: `floating-group-drag-handle="titlebar"` renders `.dv-floating-titlebar`, and dockview only shows it for floating groups.

- [ ] **Step 7: Commit**

```bash
git add -A scripts/e2e
git commit -m "test: drive the desktop shell end to end

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: Share the feature gating with the mobile shell

`apps/web/src/mobile/tabs.ts` keeps its own copy of "which panels does this hub offer". Now that `windowMeta.ts` owns that rule, the copy is a bug waiting to happen.

**Files:**

- Modify: `apps/web/src/mobile/tabs.ts` and its test, if it has one.

- [ ] **Step 1: Read the duplicate**

Run: `sed -n '1,40p' apps/web/src/mobile/tabs.ts` and `ls apps/web/src/mobile/*.test.ts`

- [ ] **Step 2: If the gating is the same rule, call `availableWindows`**

Import `availableWindows` and `type HubFeatures` from `../dock/windowMeta` and derive the phone's tab list from it, keeping the phone's own order and its own extra tabs. If the phone genuinely gates differently (it has no `tree` window, for instance), leave it alone and add a one-line comment at each site pointing at the other, so the next reader knows they are deliberate twins.

- [ ] **Step 3: Run the tests and the mobile check**

Run: `npm test -w apps/web` and `node scripts/verify-mobile-ui.mjs`
Expected: PASS. The mobile check asserts `dockview-theme-abyss` is absent on a phone and present on a desktop, both of which still hold.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/mobile
git commit -m "refactor: one rule for which windows a hub offers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done when

- `npm test -w apps/web` passes, with new suites for `box`, `windowMeta`, `placement`, `snap`, `windowState`, `taskbar` and `dockviewInternals`.
- `npm run typecheck -w apps/web` is clean.
- `npm run e2e` passes, including the new `desktop` spec.
- `node scripts/verify-mobile-ui.mjs` passes.
- `apps/web/src/App.vue` is shorter than it was, and no file in `apps/web/src/dock/` is over 400 lines.
- The browser walk-through in Task 12 has been done and every gesture behaves.
