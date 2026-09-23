import { describe, expect, it } from "vitest";
import { opensPictureViewer, pictureNameOf, type ClickedPicture } from "./pictureClick";

const clicked = (over: Partial<ClickedPicture> = {}): ClickedPicture => ({
  isImage: true,
  isRenderedPicture: true,
  decoded: true,
  inPlaceholder: false,
  onButton: false,
  menuOpen: false,
  ...over,
});

describe("opensPictureViewer", () => {
  it("opens on a picture already shown in the message", () => {
    expect(opensPictureViewer(clicked())).toBe(true);
  });

  it("leaves the click-to-load placeholder alone", () => {
    // The placeholder's own click loads the image; nothing is shown yet.
    expect(opensPictureViewer(clicked({ inPlaceholder: true }))).toBe(false);
  });

  it("leaves a card's buttons alone", () => {
    expect(opensPictureViewer(clicked({ onButton: true, isImage: false }))).toBe(false);
    // An <img> inside a button (were one ever rendered) is still the button's.
    expect(opensPictureViewer(clicked({ onButton: true }))).toBe(false);
  });

  it("ignores anything that is not one of our pictures", () => {
    expect(opensPictureViewer(clicked({ isImage: false }))).toBe(false);
    expect(opensPictureViewer(clicked({ isRenderedPicture: false }))).toBe(false);
  });

  it("leaves the picture's own menu alone", () => {
    // A held finger on a phone opens the menu and still ends in a click; that
    // click must not open the viewer behind the menu the user just asked for.
    expect(opensPictureViewer(clicked({ menuOpen: true }))).toBe(false);
  });

  it("ignores a picture the browser could not decode", () => {
    // Nothing to magnify: a broken image would open an empty viewer.
    expect(opensPictureViewer(clicked({ decoded: false }))).toBe(false);
  });
});

describe("pictureNameOf", () => {
  it("prefers the name a file card gave the picture", () => {
    expect(pictureNameOf({ alt: "cat.png", title: "cat.png", src: "blob:x" })).toBe("cat.png");
    expect(pictureNameOf({ alt: "", title: "cat.png", src: "blob:x" })).toBe("cat.png");
  });

  it("falls back to the file name in the address", () => {
    expect(pictureNameOf({ alt: "", title: "", src: "https://h/a/b/pic.png?x=1#y" })).toBe(
      "pic.png",
    );
  });

  it("is empty rather than wrong when the address says nothing", () => {
    expect(pictureNameOf({ alt: "", title: "", src: "blob:nothing-here/" })).toBe("");
    expect(pictureNameOf({ alt: "", title: "", src: "" })).toBe("");
  });
});
