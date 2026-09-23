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

/**
 * Width of the left-hand icon column. A window opened from an icon starts to
 * the right of it, so the click that opened it does not bury the launcher it
 * was clicked from. The starter desktop does NOT reserve it — see
 * `starterDesktop` — because a full-screen tiling with a blank stripe down one
 * side looks like a bug. Derived from `desktop.css`: the `.icons` container has
 * 10px padding on each side, and `.desk-icon` is a 92px-wide (border-box)
 * box, so one column of icons occupies `10 + 92 + 10 = 112px`. If either of
 * those numbers changes, update this constant too.
 */
export const ICON_GUTTER = 112;

/** Share of the desktop taken by the channel tree. */
export const TREE_WIDTH_RATIO = 0.2;
/** Share of the desktop taken by the music column. */
export const MUSIC_WIDTH_RATIO = 0.26;
/** Share of the height taken by the video, above the chat/info row. */
export const VIDEO_HEIGHT_RATIO = 0.43;

/** The box for the `index`-th window opened from an icon. */
export function cascadeBox(index: number, desktop: DesktopSize): Box {
  let width = fitSize(CASCADE_WIDTH, desktop.width, MIN_SIZE, MAX_SHARE);
  let height = fitSize(CASCADE_HEIGHT, desktop.height, MIN_SIZE, MAX_SHARE);
  // Cap to desktop dimensions so the window never exceeds the desktop bounds.
  width = Math.min(width, desktop.width);
  height = Math.min(height, desktop.height);
  // The cascade restarts rather than walking a long-lived desktop off its edge.
  const step = (Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0) % CASCADE_LENGTH;
  const offset = CASCADE_ORIGIN + step * CASCADE_STEP;
  // Start clear of the icon gutter, so a window opened from an icon does not
  // immediately cover it. The x clamp below still wins on a desktop narrower
  // than the gutter plus the window, keeping the box on-desktop with a
  // positive width rather than pushing it off the right edge.
  return {
    x: clampNumber(ICON_GUTTER + offset, 0, Math.max(0, desktop.width - width)),
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
 * video stacked over the middle one, tiled across the WHOLE desktop. The
 * columns used to start right of `ICON_GUTTER`, which kept the icons in the
 * clear but left an empty stripe down the left of an otherwise full-screen
 * arrangement — it read as a rendering fault rather than as breathing room.
 *
 * The icons do go under the tree, and that is deliberate: they are still one
 * click away, because the taskbar's show-desktop button minimises everything,
 * each window has its own taskbar button and minimise control, and the tree
 * can simply be dragged aside. Only the starter default covers them; a window
 * opened from an icon later on still steps clear of the column (`cascadeBox`),
 * so the launcher stays visible during ordinary use.
 *
 *   tree (20%) | [ video ] over [ chat | info ] | music (26%)
 */
export function starterDesktop(
  features: HubFeatures,
  desktop: DesktopSize,
): readonly StarterWindow[] {
  // The proportions apply to the full desktop width, and the middle column
  // takes whatever the rounding leaves, so the columns exactly fill it.
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
