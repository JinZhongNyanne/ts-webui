import { defineComponent, h, type Component } from "vue";
import ChannelTree from "../components/ChannelTree.vue";
import ChatDock from "./ChatDock.vue";
import InfoPanel from "../components/InfoPanel.vue";
import MusicPanel from "../components/MusicPanel.vue";
import VideoPanel from "../components/VideoPanel.vue";
import AppsPanel from "../components/AppsPanel.vue";
import SoundboardPanel from "../components/SoundboardPanel.vue";
import FileBrowserPanel from "../components/FileBrowserPanel.vue";

/**
 * dockview passes each panel component a `params` prop. Our panels are driven by
 * Pinia and don't use it, so wrap them with inheritAttrs:false to keep that prop
 * (and dockview's api objects) from leaking onto the DOM.
 */
function panel(component: Component) {
  return defineComponent({
    name: "DockPanel",
    inheritAttrs: false,
    setup() {
      return () => h("div", { class: "dock-fill" }, [h(component)]);
    },
  });
}

export const dockComponents: Record<string, Component> = {
  tree: panel(ChannelTree),
  // Chat panels receive their conversation via dockview params, so no wrapper.
  chat: ChatDock,
  info: panel(InfoPanel),
  music: panel(MusicPanel),
  video: panel(VideoPanel),
  apps: panel(AppsPanel),
  sounds: panel(SoundboardPanel),
  files: panel(FileBrowserPanel),
};
