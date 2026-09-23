import { describe, expect, it } from "vitest";
import { reactive } from "vue";
import { createFileBrowserStore } from "./fileBrowser";

function setup(self: string | null = "1") {
  let gone: () => void = () => {};
  const state = reactive({ self });
  const store = createFileBrowserStore({
    selfChannelId: () => state.self,
    onSessionGone: (fn) => (gone = fn),
  })();
  return { store, state, endSession: () => gone() };
}

describe("file browser store", () => {
  it("follows my own channel until one is picked", () => {
    const { store, state } = setup();
    expect(store.channelId.value).toBe("1");
    state.self = "2";
    expect(store.channelId.value).toBe("2");
    store.setChannel("5");
    state.self = "3";
    expect(store.channelId.value).toBe("5");
  });

  it("open() switches channel at its root and asks for the window", () => {
    const { store } = setup();
    store.setPath("/docs");
    store.open("5");
    expect(store.channelId.value).toBe("5");
    expect(store.path.value).toBe("/");
    expect(store.openTick.value).toBe(1);
  });

  it("open() on the channel already shown keeps the folder", () => {
    const { store } = setup();
    store.setChannel("5");
    store.setPath("/docs");
    store.open("5");
    store.open();
    expect(store.path.value).toBe("/docs");
    expect(store.openTick.value).toBe(2);
  });

  it("forgets everything when the session ends", () => {
    const { store, endSession } = setup();
    store.setChannel("5");
    store.setPath("/x");
    endSession();
    expect(store.channelId.value).toBe("1");
    expect(store.path.value).toBe("/");
  });
});
