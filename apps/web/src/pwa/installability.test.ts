/**
 * Checks the manifest that actually ships (public/manifest.webmanifest)
 * against the install criteria, so a field dropped by hand cannot silently
 * cost the app its install prompt — the browser reports nothing when a
 * manifest is merely incomplete, it just stops offering to install.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { installabilityProblems, REQUIRED_ICON_SIZES } from "./installability";

const manifestUrl = new URL("../../public/manifest.webmanifest", import.meta.url);
const manifest: unknown = JSON.parse(readFileSync(fileURLToPath(manifestUrl), "utf8"));

function iconsOf(value: unknown): { src: string }[] {
  return (value as { icons: { src: string }[] }).icons;
}

describe("the shipped manifest", () => {
  it("meets every install criterion", () => {
    expect(installabilityProblems(manifest)).toEqual([]);
  });

  it("points only at icon files that exist", () => {
    for (const icon of iconsOf(manifest)) {
      const file = fileURLToPath(new URL(`../../public${icon.src}`, import.meta.url));
      expect(existsSync(file), icon.src).toBe(true);
    }
  });
});

describe("installabilityProblems", () => {
  it("names a missing required field rather than passing it over", () => {
    const { name: _dropped, ...noName } = manifest as Record<string, unknown>;
    expect(installabilityProblems(noName)).toContain("name is missing");
  });

  it("rejects an icon set without the sizes a browser insists on", () => {
    const thin = { ...(manifest as object), icons: iconsOf(manifest).slice(0, 1) };
    for (const size of REQUIRED_ICON_SIZES) {
      expect(installabilityProblems(thin)).toContain(`no ${size}x${size} PNG icon`);
    }
  });

  it("rejects an icon set with no maskable variant", () => {
    const unmasked = {
      ...(manifest as object),
      icons: iconsOf(manifest).filter(
        (icon) => (icon as { purpose?: string }).purpose !== "maskable",
      ),
    };
    expect(installabilityProblems(unmasked)).toContain("no maskable icon");
  });

  it("rejects a display mode that would keep the browser chrome", () => {
    expect(installabilityProblems({ ...(manifest as object), display: "browser" })).toContain(
      "display must be one of standalone, fullscreen, minimal-ui",
    );
  });

  it("rejects a start_url outside the scope, which would never launch", () => {
    expect(
      installabilityProblems({ ...(manifest as object), start_url: "/elsewhere/", scope: "/app/" }),
    ).toContain("start_url is outside scope");
  });

  it("rejects something that is not a manifest at all", () => {
    expect(installabilityProblems(null)).toEqual(["not an object"]);
  });
});
