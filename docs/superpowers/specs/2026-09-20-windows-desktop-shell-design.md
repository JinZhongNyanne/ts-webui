# Windows-style desktop shell

Status: design, awaiting review
Date: 2026-09-20
Scope: `apps/web` desktop shell only. The mobile shell (`MobileShell`) is untouched.

## Goal

Turn the client's shell into a desktop-OS metaphor:

- the top bar and the bottom bar are fixed chrome that windows can never cover;
- the top bar is a **taskbar**: it lists only the windows that are currently open;
- the area between the bars is a **desktop**: it carries icons, and double-clicking
  an icon opens that panel;
- every panel is a **floating window** that can be moved, resized, minimised,
  maximised, closed, and **snapped** to half/quarter of the desktop by dragging it
  to an edge, the way Windows' Aero Snap works.

dockview stays. What changes is that its grid is no longer where panels live: it is
left permanently empty and becomes the desktop surface, while every panel lives in
the floating layer above it. Stacking two windows into one tabbed frame keeps
working, because that is dockview's own tab behaviour.

## Decisions taken during brainstorming

| Question                          | Decision                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| How are panels opened?            | Desktop icons, double-click.                                                                                                                         |
| What does dragging to an edge do? | Aero Snap: half (edges) / quarter (corners), plus maximise. The window stays a floating window; it never becomes a grid pane.                        |
| Keep tab-grouping?                | Yes — stay on dockview so windows can still be stacked as tabs.                                                                                      |
| Taskbar behaviour                 | Full Windows behaviour: minimise / maximise / close; minimised windows keep their taskbar button; clicking the focused window's button minimises it. |
| First run                         | Auto-open a starter set of windows, arranged like today's default layout.                                                                            |

## Architecture

### Shell

`App.vue` keeps its column flex; the three regions gain explicit roles:

```
banners        flex:none   (unchanged)
Taskbar        flex:none   top chrome — only open windows
.desktop       flex:1      dockview container: wallpaper, icons, floating windows
StatusBar      flex:none   bottom chrome (unchanged)
```

Floating groups are clamped to the dockview container, so a window can never overlap
either bar. Docking into the grid is disabled, so the grid stays empty and the desktop
is always the backdrop.

### Modules

New, all under `apps/web/src/dock/`:

| File                   | Purpose                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windowMeta.ts`        | The icon + i18n label for each window kind. Shared by the desktop icons and the taskbar (today this table is private to `WindowBar.vue`).                                                    |
| `placement.ts`         | Pure. Cascade box for the n-th opened window; the starter-desktop arrangement. Replaces `summon.ts`'s grid placement rules and `layout.ts`'s pixel maths.                                    |
| `snap.ts`              | Pure. `snapZoneFor(box, container)` → `left \| right \| top \| tl \| tr \| bl \| br \| null`; `snapBox(zone, container)` → box. Edge thresholds and hysteresis live here.                    |
| `windowState.ts`       | The minimised / maximised state of each window, and its pre-maximise box. Persisted in a sidecar localStorage key.                                                                           |
| `Desktop.vue`          | The icon surface rendered behind the floating layer.                                                                                                                                         |
| `DesktopIcon.vue`      | One icon: select on click, open on double-click or Enter.                                                                                                                                    |
| `Taskbar.vue`          | Replaces `WindowBar.vue`.                                                                                                                                                                    |
| `SnapOverlay.vue`      | The translucent snap preview drawn while a window is dragged to an edge.                                                                                                                     |
| `dockviewInternals.ts` | The one place that reaches past `DockviewApi` into dockview's component object (see _Leaning on dockview internals_). Every cast lives here, guarded, so a dockview upgrade breaks one file. |

Changed: `App.vue` (shell wiring), `dockWindows.ts` (open-as-floating, minimise,
maximise, raise), `HeaderActions.vue` (window controls).

Removed: `WindowBar.vue`, `summon.ts`'s `summonPosition` placement rules,
`layout.ts` as a dockview-grid sizer (its ratios move into `placement.ts`).
Kept: `panels.ts`, `ChatDock.vue`, `floatDrop.ts`.

## Behaviour

### Desktop

One icon per window the connected hub offers (video, music and files only appear when
the hub has them), flowing top-left down columns like Windows. Click selects,
double-click or Enter opens. Opening a window that is already open raises it instead
of creating a second one.

### Windows

- A window opens as a floating group, cascaded from the previously opened one, and
  clamped inside the desktop.
- The titlebar drags the window. Double-clicking it toggles maximise.
- The window controls are **— minimise**, **□ maximise / restore**, **✕ close**.
  Minimising hides the window but keeps its taskbar button; maximising remembers the
  pre-maximise box so restore is exact.
- Minimising is a `visibility: hidden` class on the window's overlay element, **not**
  dockview's `setVisible(false)`: that sets `display: none`, and dockview then re-clamps
  the window from its now-zero bounding box on the next layout, moving it off-screen and
  serialising it as 0x0.
- Maximise and snap both move _and_ resize a window, which dockview only exposes on its
  floating-group object (`position({ top, left, width, height })`); `group.api.maximize()`
  returns without doing anything for a floating group, and re-adding it as a floating
  group would tear down and rebuild its DOM, reloading every iframe and video element in
  it. `top`/`left` are always passed explicitly so the window's anchor stays deterministic.
- Moving a window this way does not fire a layout change, so the shell saves the layout
  itself after a snap, a maximise or a restore.
- A panel added as a floating window is not made active by dockview, so opening one is
  always followed by an explicit activate, which also raises it above its siblings.
- Dropping a tab on another window's tab bar still stacks them; dropping a tab on a
  window's content centre still tears it out into its own window (`floatDrop.ts` keeps
  earning its place: it is now the _only_ way to un-stack a tab). Drops on a window's
  content _edges_ are vetoed, because dockview would otherwise split the window's own
  interior into two panes.
- Docking into the grid is switched off wholesale (`dndEdges: false`), which disables the
  one drop target that can create or split grid groups. The desktop can therefore never
  be covered by a docked pane.

### Aero Snap

While a window is dragged, `transformFloatingGroupDrag` runs each frame with the
window's proposed box and the desktop's size. `snap.ts` turns that into an armed zone;
the armed zone is published to a reactive ref and drawn by `SnapOverlay.vue` as a
translucent preview. `onDidEndFloatingGroupDrag` commits it: the window is moved to the
zone's box. Corners give a quarter, the left and right edges a half, the top edge
maximises. Holding Alt suspends snapping and drags freely.

dockview's own Smart Guides (float-to-float alignment) is an Enterprise module and is
not installed, so it plays no part here; setting the option would only log an error.

Two mechanics the drag hook forces:

- the drag-end event also fires at the end of a _resize_, so the commit is gated on a
  zone actually having been armed by a move;
- `transformFloatingGroupDrag` is captured when a floating window is created, not read
  per frame, so it is passed in the initial dockview props (as `dndEdges` already is)
  and never swapped at runtime.

### Taskbar

One button per open window, showing its icon and title, marking the active window and
dimming minimised ones. Clicking a background window raises and focuses it; clicking
the focused window minimises it; right-clicking closes it. Each chat conversation gets
its own button.

### First run, persistence and reset

With no saved layout the desktop opens the channel tree, the server chat and the info
panel, plus video and music when the hub offers them, arranged in the proportions of
today's default layout so the client looks familiar. The layout is serialised as it is
today; minimised/maximised state rides along in a sidecar key. The status bar's ⊞
button resets to the starter desktop.

## Error handling

The desktop box is unknown on the first frame (dockview reports 0×0) and NaN for a
detached element; every placement and snap function returns `null` for a box it cannot
size against, and the caller retries on the next frame — the pattern `layout.ts` already
uses. Restoring a layout that names a panel the hub no longer offers drops that window
rather than failing the restore, so a hub losing its music bot cannot wedge the desktop.

## Leaning on dockview internals

Three things this design needs are not on `DockviewApi`: a floating window's
move+resize, the floating-group list to find it, and the drag-end event. All three exist
at runtime on dockview's component object. Rather than sprinkle casts, `dockviewInternals.ts`
exposes exactly three narrow, documented functions over it and is the only file that
casts. Each one checks the shape it expects and returns a "not available" result instead
of throwing, so a future dockview upgrade that moves these degrades the desktop to
plain floating windows rather than breaking the client. Its unit tests feed it a fake
component object, including a malformed one.

## Migration and blast radius

Taken from an inventory of every reference to the dock module.

### Chat windows and the store loop

Each conversation is a dock panel today (`App.vue` `ensureChatPanel`), and the dock
drives the store: `onDidActivePanelChange` calls `ts.openConversation`, which is how a
notification click and a channel-tree click bring the right chat forward. That loop is
load-bearing and survives unchanged — a conversation still gets its own panel; it just
opens as a window rather than a tab next to `chat:server`. Conversations opened in the
background (an incoming message, joining a channel) open **minimised**: they appear in
the taskbar without stealing the desktop.

### Storage

`jinz.dock.layout.v3` becomes `jinz.dock.layout.v4`, so a user holding a saved grid
layout gets the starter desktop instead of a restore that cannot work. The v3 key is
deleted on first run of the new shell. The restore path's pruning of stale
`chat:client:*` / `chat:channel:*` panels is kept. The one-time `jinz.dock.videoSeen`
and `jinz.dock.musicSeen` migrations belonged to the old default layout and are retired.

### i18n

Two catalogues, `zh-CN.ts` (the source of the `Messages` type) and `en.ts`; parity is
enforced by `vue-tsc`, not by a test, so every key is added to both. `dock.windows`,
`dock.showWindow` and `dock.reopenWindow` are reused; `dock.floatHere` stays, since tearing a tab
out by dropping it on a window's centre stays (and its hint is now the only signpost for
it); `dock.float` is retired along with the dock-a-window-into-the-grid button; `dock.closeGroup` is reworded away from "the
window bar reopens them". New keys: minimise, maximise, restore, and the desktop's
aria-label.

### Theme skins

`needy.css` and `ame.css` both style `.window-bar.glass-host` and `.dock .dv-*`. The
taskbar keeps the `window-bar` class name (adding `taskbar`) so neither skin breaks, and
both gain a rule for the desktop surface. `.dock-wrap` keeps its name — the skins target
`.dock-wrap .mshell` for the mobile shell.

### E2E

The Playwright specs under `scripts/e2e/specs` are the only safety net for the shell,
since the dockview-facing code has no unit tests. Three migrations are needed:

- `rig.mjs`'s `openChat` clicks `.dv-tab`; roughly seven specs depend on it. It changes
  to click the conversation's taskbar button, so the fix lands in one helper.
- `apps-panel`, `soundboard` and `m3-file-browser` open windows via `.window-bar .win-btn`;
  they change to double-clicking the desktop icon.
- `settings-panel` clicks `status-reset-layout` and then uses the tree; the testid stays
  and the assertion is re-pointed at the starter desktop.

`data-testid="dock-close-group"` stays on the window's close button, and the desktop
container keeps `dockview-theme-abyss` — `scripts/verify-mobile-ui.mjs` asserts on it
across the mobile breakpoint.

### Feature gating

`mobile/tabs.ts` keeps its own copy of the "which panels does this hub offer" rule that
`summonableWindows` encodes. The new `windowMeta.ts` exports one gating function and
both shells use it.

### Tests being deleted

`summonPosition`'s 22 cases and `defaultLayoutSizes`' 10 cases go obsolete together. Their
replacements in `placement.ts` and `snap.ts` are written first, so coverage never dips.
`floatDrop.test.ts`'s `floatBoxAt` cases survive: the same clamping maths places a new
window and a snapped one.

## Testing

- **Pure units** (vitest, beside the source, as the dock module already does):
  `snap.ts` zones, boxes and thresholds; `placement.ts` cascade and starter layout;
  `windowState.ts` transitions, including maximise → restore round-tripping.
- **Component**: the taskbar lists only open windows and marks active/minimised
  correctly; a desktop icon opens its panel on double-click and raises it when already
  open.
- **E2E** (the existing Playwright spec): open a panel from its desktop icon → its
  taskbar button appears → minimise hides it and keeps the button → clicking the button
  restores it → dragging to the left edge snaps it to half the desktop → close removes
  the button.

## Out of scope

The mobile shell; wallpaper/theming of the desktop beyond what the current skins give;
desktop icon rearrangement by the user; multiple virtual desktops.
