/**
 * The desktop background: right-click the empty desktop, pick a picture, say
 * how it should be fitted, and take it away again.
 *
 * Everything is asserted on the computed style of the wallpaper layer — what
 * the screen really shows — rather than on the app's own state.
 */
import assert from "node:assert/strict";
import { until } from "../lib/rig.mjs";

export const title = "desktop: right-click changes the background picture and how it is fitted";

/** A 2×2 red PNG; a wallpaper only has to decode, not to look like anything. */
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64",
);

const layer = (page) => page.locator("[data-testid=desktop-wallpaper]");
const menuItem = (page, id) => page.locator(`[data-testid=${id}]`);

/** The computed background properties of the wallpaper layer. */
const paintedStyle = (page) =>
  layer(page).evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      image: css.backgroundImage,
      size: css.backgroundSize,
      repeat: css.backgroundRepeat,
      position: css.backgroundPosition,
    };
  });

/** Right-clicks the middle of the desktop, where no window and no icon is. */
async function openDesktopMenu(page) {
  const dock = await page.locator(".dock").boundingBox();
  await page.mouse.click(dock.x + dock.width / 2, dock.y + dock.height / 2, { button: "right" });
  await menuItem(page, "desktop-wallpaper-choose").waitFor({ state: "visible", timeout: 10_000 });
}

/** Opens the menu and picks `file` through the item that drives the picker. */
async function chooseWallpaper(page, file) {
  await openDesktopMenu(page);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    menuItem(page, "desktop-wallpaper-choose").click(),
  ]);
  await chooser.setFiles(file);
}

export default async function desktopWallpaper(rig) {
  const alice = await rig.connect("alice", { channel: "a" });
  const page = alice.page;
  await page.locator(".tree").waitFor({ state: "visible" });

  /* ------------- the menu belongs to the desktop, and only to it ------------ */

  // Inside a window: dockview renders floating windows in overlays beside the
  // watermark, so the desktop's handler must never see this click. The tree
  // has a context menu of its own, which is what should answer instead.
  const tree = page.locator(".tree");
  await tree.click({ button: "right", position: { x: 5, y: 5 } });
  assert.equal(
    await menuItem(page, "desktop-wallpaper-choose").count(),
    0,
    "right-clicking inside a window must not offer the desktop's background menu",
  );
  await page.keyboard.press("Escape");

  // Clear the desktop so the middle of it is bare desktop and nothing else —
  // and so the icons are reachable at all: the starter desktop tiles the whole
  // screen, with the channel tree's window over the icon column.
  await page.getByTestId("taskbar-minimize-all").click();
  await page.locator(".tree").waitFor({ state: "hidden" });

  // On an icon: the click bubbles up to the desktop, so it is excluded by name.
  const icon = page.locator("[data-testid=desktop-icon]").first();
  await icon.waitFor({ state: "visible", timeout: 15_000 });
  await icon.click({ button: "right" });
  assert.equal(
    await menuItem(page, "desktop-wallpaper-choose").count(),
    0,
    "right-clicking a desktop icon must not offer the desktop's background menu",
  );
  await page.keyboard.press("Escape");

  /* ----------------------------- a picture goes on ----------------------------- */

  assert.equal(await layer(page).count(), 0, "no wallpaper before one is chosen");
  // What the theme paints on the bare desktop, to compare against after the
  // wallpaper has been taken away again.
  const themeBackground = await page
    .locator("[data-testid=desktop]")
    .evaluate((el) => getComputedStyle(el).background);
  await chooseWallpaper(page, { name: "wall.png", mimeType: "image/png", buffer: PICTURE });
  await layer(page).waitFor({ state: "attached", timeout: 10_000 });

  // Fill is the default: cover, once, centred.
  const filled = await paintedStyle(page);
  assert.match(filled.image, /^url\("blob:/, `the picture should be painted, was ${filled.image}`);
  assert.equal(filled.size, "cover", "Fill means cover");
  assert.equal(filled.repeat, "no-repeat");

  /* --------------------------- and is fitted to taste -------------------------- */

  await openDesktopMenu(page);
  await menuItem(page, "desktop-wallpaper-fit-stretch").click();
  await until(
    async () => (await paintedStyle(page)).size === "100% 100%",
    "Stretch fills the desktop exactly, aspect ratio ignored",
  );

  await openDesktopMenu(page);
  await menuItem(page, "desktop-wallpaper-fit-tile").click();
  await until(async () => {
    const css = await paintedStyle(page);
    return css.repeat === "repeat" && css.size === "auto";
  }, "Tile repeats the picture at its natural size");

  await openDesktopMenu(page);
  await menuItem(page, "desktop-wallpaper-fit-fit").click();
  await until(
    async () => (await paintedStyle(page)).size === "contain",
    "Fit shows the whole picture, letterboxed",
  );

  /* ------------------- a file that is not a picture is refused ------------------ */

  await chooseWallpaper(page, {
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("<html>not a picture</html>"),
  });
  await page.getByTestId("desktop-wallpaper-error").waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(
    (await paintedStyle(page)).size,
    "contain",
    "a refused file must leave the wallpaper that was already there alone",
  );

  /* ----------------------- and the theme's own background back ------------------ */

  await openDesktopMenu(page);
  await menuItem(page, "desktop-wallpaper-remove").click();
  await layer(page).waitFor({ state: "detached", timeout: 10_000 });
  const themed = await page
    .locator("[data-testid=desktop]")
    .evaluate((el) => getComputedStyle(el).background);
  assert.equal(
    themed,
    themeBackground,
    "removing the wallpaper should leave exactly the theme's own background",
  );

  // The desktop is put back the way the other specs expect to find it.
  await page.getByTestId("taskbar-minimize-all").click();
  await page.locator(".tree").waitFor({ state: "visible" });
}
