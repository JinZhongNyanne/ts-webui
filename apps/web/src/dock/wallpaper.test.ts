import { describe, expect, it } from "vitest";
import {
  DEFAULT_WALLPAPER_FIT,
  WALLPAPER_FITS,
  WALLPAPER_MAX_BYTES,
  isWallpaperFit,
  parseWallpaperFit,
  validateWallpaperFile,
  wallpaperStyle,
} from "./wallpaper";

describe("parseWallpaperFit", () => {
  it("keeps a mode it knows", () => {
    for (const fit of WALLPAPER_FITS) expect(parseWallpaperFit(fit)).toBe(fit);
  });

  it("falls back for anything else", () => {
    expect(parseWallpaperFit(null)).toBe(DEFAULT_WALLPAPER_FIT);
    expect(parseWallpaperFit(undefined)).toBe(DEFAULT_WALLPAPER_FIT);
    expect(parseWallpaperFit("crop")).toBe(DEFAULT_WALLPAPER_FIT);
  });

  it("recognises only the five modes", () => {
    expect(isWallpaperFit("tile")).toBe(true);
    expect(isWallpaperFit("Tile")).toBe(false);
    expect(isWallpaperFit(3)).toBe(false);
  });
});

describe("wallpaperStyle", () => {
  const url = "blob:http://localhost/abc";

  it("fills by covering and cropping", () => {
    expect(wallpaperStyle(url, "fill")).toEqual({
      backgroundImage: `url("${url}")`,
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
  });

  it("fits the whole picture in, letterboxed", () => {
    expect(wallpaperStyle(url, "fit").backgroundSize).toBe("contain");
    expect(wallpaperStyle(url, "fit").backgroundRepeat).toBe("no-repeat");
  });

  it("stretches to the exact box, aspect ratio ignored", () => {
    expect(wallpaperStyle(url, "stretch").backgroundSize).toBe("100% 100%");
  });

  it("tiles at natural size from the corner", () => {
    expect(wallpaperStyle(url, "tile")).toMatchObject({
      backgroundSize: "auto",
      backgroundRepeat: "repeat",
      backgroundPosition: "left top",
    });
  });

  it("centres at natural size, once", () => {
    expect(wallpaperStyle(url, "center")).toMatchObject({
      backgroundSize: "auto",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center",
    });
  });

  it("escapes what could end the CSS string early", () => {
    expect(wallpaperStyle('blob:a"b\\c', "fill").backgroundImage).toBe('url("blob:a\\"b\\\\c")');
  });
});

describe("validateWallpaperFile", () => {
  it("accepts a picture of a sane size", () => {
    expect(validateWallpaperFile({ size: 2048, type: "image/png" })).toBeNull();
    expect(validateWallpaperFile({ size: 2048, type: "IMAGE/JPEG" })).toBeNull();
  });

  it("refuses an empty file", () => {
    expect(validateWallpaperFile({ size: 0, type: "image/png" })).toBe("empty");
  });

  it("refuses a file over the cap", () => {
    expect(validateWallpaperFile({ size: WALLPAPER_MAX_BYTES + 1, type: "image/png" })).toBe(
      "too-large",
    );
    expect(validateWallpaperFile({ size: WALLPAPER_MAX_BYTES, type: "image/png" })).toBeNull();
  });

  it("refuses anything that is not a raster image, SVG included", () => {
    expect(validateWallpaperFile({ size: 10, type: "image/svg+xml" })).toBe("bad-type");
    expect(validateWallpaperFile({ size: 10, type: "text/html" })).toBe("bad-type");
    expect(validateWallpaperFile({ size: 10, type: "" })).toBe("bad-type");
  });
});
