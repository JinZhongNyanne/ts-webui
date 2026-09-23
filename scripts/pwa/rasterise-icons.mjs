#!/usr/bin/env node
/**
 * Rasterises the PWA icon sources to the PNG sizes the manifest asks for.
 *
 * The icons have to be real PNG files: Chrome's install criteria do not accept
 * an SVG-only icon set, and iOS ignores `apple-touch-icon` unless it is a
 * raster image. There is no ImageMagick, sharp or rsvg in this environment,
 * but Playwright's Chromium is already a dependency (the e2e rig drives it),
 * and it is the same renderer that will display the icons — so the art is
 * reproducible from the committed SVG with no new dependency.
 *
 * Usage: node scripts/pwa/rasterise-icons.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ICON_DIR = fileURLToPath(new URL("../../apps/web/public/icons/", import.meta.url));

/** Every PNG the manifest, the favicon links and iOS refer to. */
const TARGETS = [
  { source: "icon.svg", size: 512, out: "icon-512.png" },
  { source: "icon.svg", size: 192, out: "icon-192.png" },
  { source: "icon.svg", size: 180, out: "apple-touch-icon.png" },
  { source: "icon.svg", size: 32, out: "favicon-32.png" },
  { source: "icon-maskable.svg", size: 512, out: "icon-maskable-512.png" },
  { source: "icon-maskable.svg", size: 192, out: "icon-maskable-192.png" },
];

/** An <img> at exactly the target size, so Chromium scales the vector, not a bitmap. */
function pageFor(svg, size) {
  const data = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return (
    `<!doctype html><html><body style="margin:0;background:transparent">` +
    `<img id="icon" src="${data}" width="${size}" height="${size}"></body></html>`
  );
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const target of TARGETS) {
    const svg = readFileSync(path.join(ICON_DIR, target.source), "utf8");
    await page.setViewportSize({ width: target.size, height: target.size });
    await page.setContent(pageFor(svg, target.size));
    await page.locator("#icon").screenshot({
      path: path.join(ICON_DIR, target.out),
      omitBackground: true,
    });
    console.log(`${target.out}  ${target.size}x${target.size}  <- ${target.source}`);
  }
} finally {
  await browser.close();
}
