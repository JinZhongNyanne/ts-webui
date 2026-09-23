import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { installI18n, t } from "./i18n";
import { useTsStore } from "./stores/ts";
import { reloadOnce } from "./ts/reloadOnce";
import { registerServiceWorkerFromApp } from "./pwa/register";
import { installAppBadge } from "./pwa/installBadge";
import { usePermsStore } from "./stores/perms";
import { useTransfersStore } from "./stores/transfers";
import "dockview-vue/dist/styles/dockview.css";
import "./styles/base.css";

const app = createApp(App);
app.use(createPinia());
// Listening from the start: the full permission set arrives once, right after connecting.
usePermsStore();
// Also from the start: transfers must fail as soon as the session they belong to ends.
useTransfersStore();
installI18n(app);
app.mount("#app");
// Tells public/boot.js the bundle loaded and ran; it stops watching.
(window as unknown as { __jinzBooted?: boolean }).__jinzBooted = true;

// After mounting, and never in the way: the worker only makes the app
// installable, and it reports its own failures rather than raising them.
void registerServiceWorkerFromApp();
// Likewise: the icon's unread badge, on browsers that have one.
installAppBadge();

// A lazily loaded chunk (Opus decoder, RNNoise, LiveKit...) from a build that
// has since been replaced. Before connecting, reloading is free; mid-call it
// would drop the voice session, so say so and let the user choose the moment.
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  if (useTsStore().connState !== "connected" && reloadOnce()) return;
  useTsStore().pushEvent(t("event.pageUpdated"), "warn");
});
