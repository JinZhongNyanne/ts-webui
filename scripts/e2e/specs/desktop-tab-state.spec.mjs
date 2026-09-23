/**
 * Moving a tab in or out of a tab bar must not KILL anything — it may only
 * hide it.
 *
 * dockview's default renderer (`onlyWhenVisible`) takes a panel's content out
 * of the document whenever it is not the visible tab, and puts a fresh copy
 * back afterwards: an iframe reloads, a video restarts, a scrolled list jumps
 * back to the top. The desktop therefore runs with `default-renderer="always"`
 * (see `App.vue`), which renders every panel once into a shared overlay that
 * only ever moves. This spec is the proof: a chat window is scrolled and given
 * an unsent draft, then stacked into another window, hidden behind its tab
 * partner, brought back, and finally torn out onto the desktop — and none of
 * that state is allowed to change. Reverting the renderer makes the scroll
 * assertion below fail.
 *
 * It also pins the other half of "don't kill it": a torn-out tab comes back at
 * the SIZE of the window it had before it was stacked — and lands at the drop
 * POINT, like every other float-at-pointer gesture
 * (`tearOutBox` in `apps/web/src/dock/floatDrop.ts`).
 */
import assert from "node:assert/strict";

export const title = "desktop: a tab's live state and its window survive stacking and tear-out";

/** The draft left in the composer, which must never be sent or lost. */
const DRAFT = "half a thought, not sent";

/** Drags a `.dv-tab` to a point by its native HTML5 drag-and-drop. */
async function dragTabTo(page, tab, x, y) {
  const box = await tab.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(startX + i * 2, startY + i, { steps: 1 });
    await page.waitForTimeout(20);
  }
  await page.mouse.move(x, y, { steps: 20 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/**
 * Where a float dropped at a page point must land, in `windowBox` coordinates.
 *
 * The same maths as `floatBoxAt` in `apps/web/src/dock/floatDrop.ts`: centred
 * horizontally on the pointer, the tab bar just under it, clamped inside the
 * dock. Floating windows are positioned inside dockview's own grid, so the
 * point is measured against that, then reported relative to `.dock` as
 * `windowBox` does.
 */
const GRAB_OFFSET = 16;
async function expectedFloatBox(page, pageX, pageY, width, height) {
  const dock = await page.locator(".dock").boundingBox();
  const host = (await page.locator(".dock .dv-dockview").first().boundingBox()) ?? dock;
  const clamp = (v, max) => Math.min(Math.max(v, 0), Math.max(0, max));
  return {
    x: Math.round(
      host.x - dock.x + clamp(Math.round(pageX - host.x - width / 2), host.width - width),
    ),
    y: Math.round(
      host.y - dock.y + clamp(Math.round(pageY - host.y - GRAB_OFFSET), host.height - height),
    ),
  };
}

/**
 * A window's box relative to the desktop, so it can be compared across a move.
 *
 * The frame is found by its TAB: with `always` the panel's content is not a
 * descendant of its own `.dv-groupview` any more.
 */
async function windowBox(page, tabText) {
  const dock = await page.locator(".dock").boundingBox();
  const frame = await page
    .locator(".dv-resize-container", { has: page.locator(".dv-tab", { hasText: tabText }) })
    .boundingBox();
  return {
    x: Math.round(frame.x - dock.x),
    y: Math.round(frame.y - dock.y),
    width: Math.round(frame.width),
    height: Math.round(frame.height),
  };
}

/**
 * Snaps a window to one half of the desktop by dragging the empty space of its
 * own tab bar to that edge, driven exactly as `desktop.spec.mjs` drives it.
 *
 * Both windows in this spec are snapped, to opposite halves. That is not
 * cosmetic: the two halves are the same SIZE, so a tab moved from one to the
 * other keeps the same content box — and a scroll position that must not
 * change has nothing it could legitimately change for. A frame of a different
 * height would re-anchor the list on resize and prove nothing either way.
 */
async function snapHalf(page, tabText, side) {
  const dock = await page.locator(".dock").boundingBox();
  const overlay = page.locator(".dv-resize-container", {
    has: page.locator(".dv-tab", { hasText: tabText }),
  });
  const handle = await overlay.locator(".dv-void-container").first().boundingBox();
  const grabX = handle.x + handle.width / 2;
  const grabY = handle.y + handle.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  // The offset between pointer and window corner is taken at the first move
  // after the press, so it has to be captured next to the grab point.
  await page.mouse.move(grabX + 1, grabY);
  const x = side === "left" ? dock.x + 4 : dock.x + dock.width - 4;
  await page.mouse.move(x, dock.y + dock.height / 2, { steps: 20 });
  await page.locator("[data-testid=snap-preview]").waitFor({ state: "visible" });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * Where the chat log is parked: which message is at the top of its viewport,
 * counted from the start of the list.
 *
 * Not the raw `scrollTop`. Avatars load late and a window's frame changes as a
 * tab is moved, and the browser answers both by shifting `scrollTop` to keep
 * the content the user is looking at where it is — so the pixel value moves
 * while the list does not. What a rebuilt panel does instead is unmistakable:
 * it starts again at the very top of the list, or scrolls itself to the newest
 * message. A handful of lines of drift is re-anchoring; a jump to either end
 * is the panel having been destroyed and made anew.
 */
const anchorOf = (log) =>
  log.evaluate((el) => {
    const top = el.getBoundingClientRect().top;
    const msgs = [...el.querySelectorAll(".msg")];
    const index = msgs.findIndex((m) => m.getBoundingClientRect().bottom > top + 1);
    return {
      index,
      total: msgs.length,
      text: index < 0 ? "" : (msgs[index].querySelector(".text")?.textContent ?? ""),
    };
  });

/** How many lines the list may drift before it stops being the same place. */
const DRIFT = 8;
/**
 * How many lines are put in the chat before it is scrolled.
 *
 * Enough that the middle of the list is many lines from either end: drift of a
 * line or two as a window re-anchors must never be confusable with a panel
 * that was rebuilt, which lands at one end or the other.
 */
const LINES = 150;

/**
 * Turns on screen-edge snapping from its taskbar switch: `snapHalf` needs it,
 * and it is off by default (`snapMode.ts`).
 */
async function snapToEdgesOn(page) {
  const toggle = page.getByTestId("taskbar-snap-edges");
  await toggle.waitFor({ state: "visible" });
  if ((await toggle.getAttribute("aria-checked")) !== "true") await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true", "screen-edge snapping is on");
}

/**
 * Leaves only the named windows on the desktop: the starter desktop tiles the
 * screen and the app opens windows of its own shortly after connecting, any of
 * which can lie over the tabs and edges this spec drags to.
 */
async function onlyWindows(page, titles) {
  await page.waitForTimeout(AUTO_WINDOWS_MS);
  await page.getByTestId("taskbar-minimize-all").click();
  for (const text of titles) {
    await page.locator("[data-testid=taskbar-button]").filter({ hasText: text }).first().click();
  }
  await page.waitForTimeout(200);
}

/** How long after connecting the app has opened the windows it opens by itself. */
const AUTO_WINDOWS_MS = 1_500;

export default async function desktopTabState(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  const channel = rig.channels.name("a");
  await page.locator(".tree").waitFor({ state: "visible" });
  await snapToEdgesOn(page);
  // The chat window comes back with `openChat`, below.
  await onlyWindows(page, ["Channels & users"]);

  /* ------------ a chat window with something to lose in it ---------------- */
  const panel = await rig.openChat(page, channel);
  // Both windows to a half of the desktop first: it gets them out of each
  // other's way, and gives them the same size — see `snapHalf`.
  await snapHalf(page, channel, "right");
  await snapHalf(page, "Channels & users", "left");
  const input = panel.locator(".composer input");
  const log = panel.locator(".log");
  // Enough lines that the log really scrolls; each one is sent, so what is at
  // stake is the panel's own state and not something the spec painted on.
  const overflow = () => log.evaluate((el) => el.scrollHeight - el.clientHeight);
  for (let batch = 0; batch < LINES / 25; batch++) {
    for (let i = 0; i < 25; i++) {
      await input.fill(`line ${batch}-${i}`);
      await input.press("Enter");
    }
    await page.waitForTimeout(300);
  }
  assert.ok(
    (await overflow()) > 400,
    "the chat log has to grow well past its window for a scroll position to exist",
  );
  // Parked in the middle of the list: not at the top, which is where a rebuilt
  // element starts, and not at the bottom, which is where the panel scrolls
  // itself when it is mounted afresh.
  await log.evaluate((el) => {
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2);
  });
  await input.fill(DRAFT);
  const parked = await anchorOf(log);
  assert.ok(
    parked.index > 2 * DRIFT && parked.index < parked.total - 2 * DRIFT,
    `the chat log must really be parked mid-list before the tab is moved, was ${JSON.stringify(parked)}`,
  );

  /** Fails unless the log is still parked on the same message, in the same place. */
  const stillParked = async (what) => {
    const now = await anchorOf(log);
    assert.ok(
      now.total === parked.total && Math.abs(now.index - parked.index) <= DRIFT,
      `the chat log must stay where it was ${what}: was ${JSON.stringify(
        parked,
      )}, is ${JSON.stringify(now)}`,
    );
  };

  const chatTab = page.locator(".dv-tab", { hasText: channel });
  const treeTab = page.locator(".dv-tab", { hasText: "Channels & users" });
  // The desktop saves — and so records where this window is — on a short timer.
  await page.waitForTimeout(800);
  const ownWindow = await windowBox(page, channel);

  /* ------------------ stacked into the other window's tab bar ------------- */
  // Into the SHORTER window on purpose. A stacked tab is re-measured against
  // its new frame, and a log that has more room to scroll in cannot have its
  // scroll position clamped on the way — so anything that changes here changed
  // because the panel was rebuilt, which is exactly what is under test.
  // Released on the empty space of the other window's tab bar, which is the
  // roomiest part of the one drop target that still stacks (everything that is
  // not a tab bar tears out instead; see `floatTargetForDrop`).
  const treeVoid = await page
    .locator(".dv-resize-container", { has: treeTab })
    .locator(".dv-void-container")
    .first()
    .boundingBox();
  await dragTabTo(page, chatTab, treeVoid.x + treeVoid.width / 2, treeVoid.y + treeVoid.height / 2);
  assert.equal(
    await page.locator(".dv-groupview", { has: chatTab }).locator(".dv-tab").count(),
    2,
    "the two tabs now share one window",
  );
  await stillParked("across being stacked");
  assert.equal(await input.inputValue(), DRAFT, "the unsent draft survives being stacked");

  /* --------------- hidden behind its tab partner, and back in front ------- */
  await treeTab.click();
  await page.waitForTimeout(250);
  await stillParked("while it is the hidden tab");
  await chatTab.click();
  await page.waitForTimeout(250);
  await stillParked("when its tab comes back");
  assert.equal(await input.inputValue(), DRAFT, "the draft survives the tab coming back");

  /* --------------------------- and torn back out -------------------------- */
  // Onto the middle of the window's own content, which is the other way to
  // un-stack a tab and, unlike the empty desktop, is always there to aim at
  // however full the desktop is. It is also nowhere near the box the chat is
  // supposed to come back to, which is the point of the last assertion.
  const contentBox = await page
    .locator(".dv-groupview", { has: chatTab })
    .locator(".dv-content-container")
    .boundingBox();
  const dropX = contentBox.x + contentBox.width / 2;
  const dropY = contentBox.y + contentBox.height / 2;
  await dragTabTo(page, chatTab, dropX, dropY);
  assert.equal(
    await page.locator(".dv-groupview", { has: chatTab }).locator(".dv-tab").count(),
    1,
    "the chat is its own window again",
  );
  await stillParked("across a tear-out");
  assert.equal(await input.inputValue(), DRAFT, "the draft survives being torn out");

  /* --------- at the size it had, under the pointer that dropped it -------- */
  const back = await windowBox(page, channel);
  assert.ok(
    Math.abs(back.width - ownWindow.width) <= 2 && Math.abs(back.height - ownWindow.height) <= 2,
    `a torn-out tab must come back at the size of the window it had: was
     ${JSON.stringify(ownWindow)}, came back as ${JSON.stringify(back)}`,
  );
  const want = await expectedFloatBox(page, dropX, dropY, back.width, back.height);
  assert.ok(
    Math.abs(back.x - want.x) <= 3 && Math.abs(back.y - want.y) <= 3,
    `a torn-out tab must land at the point it was dropped, not at the box its
     window used to have (${JSON.stringify(ownWindow)}): wanted
     ${JSON.stringify(want)}, got ${JSON.stringify(back)}`,
  );
}
