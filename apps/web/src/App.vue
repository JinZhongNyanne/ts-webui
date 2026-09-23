<script setup lang="ts">
import { computed, defineComponent, h, markRaw, onBeforeUnmount, onMounted, ref } from "vue";
import { DockviewVue, type DockviewApi, type DockviewReadyEvent } from "dockview-vue";
import { useTsStore } from "./stores/ts";
import { t } from "./i18n";
import ConnectDialog from "./components/ConnectDialog.vue";
import HubLogin from "./components/HubLogin.vue";
import { useHubAccessStore } from "./stores/hubAccess";
import StatusBar from "./components/StatusBar.vue";
import VoiceControls from "./components/VoiceControls.vue";
import SettingsPanel from "./components/settings/SettingsPanel.vue";
import { settingsOpen } from "./components/settings/settings-panel";
import ContextMenu from "./components/ContextMenu.vue";
import LogConsole from "./components/LogConsole.vue";
import HeaderActions from "./dock/HeaderActions.vue";
import Taskbar from "./dock/Taskbar.vue";
import Desktop from "./dock/Desktop.vue";
import SnapOverlay from "./dock/SnapOverlay.vue";
import SnapLayouts from "./dock/SnapLayouts.vue";
import {
  installDesktopFloatOnDrop,
  installFloatOnDrop,
  openWindow as openFloatingWindow,
} from "./dock/dockWindows";
import { availableWindows } from "./dock/windowMeta";
import type { WindowId } from "./dock/windowMeta";
import { withoutPanelRenderers } from "./dock/savedLayout";
import { useDesktop, LAYOUT_KEY } from "./dock/useDesktop";
import { useSnapLayouts } from "./dock/useSnapLayouts";
import { useSnapGroups } from "./dock/useSnapGroups";
import { useTabDrop } from "./dock/useTabDrop";
import { DOCK_THEME } from "./dock/dockTheme";
import { useAutoWindows } from "./dock/useAutoWindows";
import { starterDesktop } from "./dock/placement";
import "./dock/dropOverlay.css";
import "./dock/desktop.css";
import { dockComponents } from "./dock/panels";
import { useVoice } from "./audio/useVoice";
import { useMusicStore } from "./stores/music";
import { useProfilesStore } from "./stores/profiles";
import { useRtcStore } from "./stores/rtc";
import { useTtsStore } from "./stores/tts";
import { useThemeStore } from "./stores/theme";
import { useNotifyStore } from "./stores/notify";
import { useHotkeys } from "./hotkeys/useHotkeys";
import MobileShell from "./mobile/MobileShell.vue";
import { useViewport } from "./mobile/useViewport";
import ConfirmHost from "./components/ui/ConfirmHost.vue";
import FilePasswordHost from "./components/chat/FilePasswordHost.vue";
import HostMessageDialog from "./components/HostMessageDialog.vue";
import { useChatHistoryStore } from "./stores/chatHistory";
import ClientDialogsHost from "./components/client/ClientDialogsHost.vue";
// A picture or video opened in a chat window floats above the whole desktop, not inside it.
import MediaViewerHost from "./components/viewer/MediaViewerHost.vue";
import { useInboxOnConnect } from "./components/admin/useInboxOnConnect";
import { keepsNativeContextMenu } from "./nativeContextMenu";

const ts = useTsStore();
// Created here, right after the ts store, so it hears `connected` before any
// chat panel exists (it files messages by server from then on).
useChatHistoryStore();
const access = useHubAccessStore();
// The websocket stays shut until the hub says we may use it.
void access.check();
const voice = useVoice();
const music = useMusicStore();
useProfilesStore();
const rtc = useRtcStore();
useTtsStore();
// Sound pack + desktop notifications; subscribes to the hub after the ts store.
useNotifyStore();
// Offline messages: fetched once per connect, unread ones announced in the log.
useInboxOnConnect();
useHotkeys();
// Applies the saved theme before the first paint of the dock or connect dialog.
useThemeStore();
/**
 * Below the mobile breakpoint the dock is replaced wholesale by `MobileShell`.
 * dockview is then never mounted, so everything in this file that talks to the
 * desktop simply never runs — no branch of the layout code is mobile-aware.
 */
const { isMobile } = useViewport();

/*
 * The desktop shell suppresses the browser's own right-click menu everywhere,
 * so the app reads like an OS rather than a page — except inside real text
 * entry, where that menu is copy/paste, spellcheck and autocorrect and people
 * expect it to keep working. A single listener here owns that decision; the
 * app's own context menus (the channel tree, the client list, the taskbar's
 * right-click-to-close, …) already call `preventDefault`/`stopPropagation`
 * themselves when they open, so this only ever fires for a right click none
 * of them claimed.
 */
function onNativeContextMenu(ev: MouseEvent): void {
  if (ev.defaultPrevented) return;
  const target = ev.target;
  if (!(target instanceof Element)) return;
  const keeps = keepsNativeContextMenu({
    tagName: target.tagName,
    inputType: target instanceof HTMLInputElement ? target.type : undefined,
    isContentEditable: target instanceof HTMLElement && target.isContentEditable,
  });
  if (!keeps) ev.preventDefault();
}
onMounted(() => document.addEventListener("contextmenu", onNativeContextMenu));
onBeforeUnmount(() => document.removeEventListener("contextmenu", onNativeContextMenu));

// dockview's Vue component typings are stricter than a plain component; the
// panel wrappers are valid at runtime, so cast to satisfy the prop types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dockComponentsRaw = markRaw(dockComponents) as Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const headerActions = markRaw(HeaderActions) as any;
const CHAT = "chat:";

const desktop = useDesktop();
const auto = useAutoWindows(desktop);
/**
 * A tab drag: dropped on a window's edge it splits that window, and dropped
 * anywhere else that lands a window it snaps the way a window drag does — to
 * the screen's edges and to the other windows, as the taskbar's switches say.
 *
 * It shares the desktop's own snap preview, so a tab drag and a window drag can
 * never paint two rectangles at once, and it asks the desktop which panels are
 * minimised — an invisible window is nothing to split or line up with — and
 * what box a torn-out tab comes back at, which is the box it lines up.
 */
const tabDrop = useTabDrop(
  desktop.snapPreview,
  desktop.snapDwelling,
  (panelId) => desktop.isMinimized(panelId),
  { remembered: (panelId) => desktop.floatBoxOf(panelId) },
);
/**
 * What `tabDrop.install` handed back, kept so it can be taken down again.
 *
 * `onReady` runs more than once: the dock sits under a `v-if` on the connection
 * state *and* on the mobile breakpoint, so a reconnect or a breakpoint crossing
 * builds a new dock and readies it again. The old element's listeners die with
 * it, but the hook's own state would not — and a stale ownership of the shared
 * snap preview is exactly what lets a tab drag clear a rectangle a *window*
 * drag put up. So the installation is disposed before the next one and on
 * unmount, the way `snapGroups` already is.
 */
let tabDropInstalled: { dispose(): void } | null = null;
onBeforeUnmount(() => {
  tabDropInstalled?.dispose();
  tabDropInstalled = null;
});
/**
 * The Snap Layouts flyout has two triggers, and they meet here.
 *
 * Hovering a window's maximise button is `snapLayouts`' own doing, wired below
 * from the same delegation the window controls use. Dragging a window to the
 * top edge belongs to the drag, so `desktop.layoutsOnDrag` owns that one; it
 * is drawn without an anchor, hanging from the middle of the top edge. The
 * drag panel wins when both would show, since the user is mid-gesture.
 */
const snapLayouts = useSnapLayouts(desktop);
/**
 * Resizing one window of a snap group moves the seam it shares with its
 * neighbours. It listens for the press on dockview's resize handle in capture
 * phase, so it is installed on `window` for the app's whole life and taken down
 * with it — the same shape as the native context-menu listener above.
 */
const snapGroups = useSnapGroups(desktop);
snapGroups.install();
onBeforeUnmount(() => snapGroups.dispose());
const snapLayoutsAnchor = computed(() =>
  desktop.layoutsOnDrag.value ? null : snapLayouts.anchor.value,
);
const showSnapLayouts = computed(
  () => desktop.layoutsOnDrag.value || snapLayouts.anchor.value !== null,
);

/** Which icons the desktop shows depends on what the hub offers. */
const desktopIcons = computed(() =>
  availableWindows({
    video: ts.features.video,
    music: ts.features.music && (music.available || !!ts.profile.musicBot.trim()),
    files: !!ts.features.files,
  }),
);

/**
 * dockview needs the watermark as a raw component, and the desktop's icons and
 * its open handler come from this file, so it is wrapped here.
 */
const desktopComponent = markRaw(
  defineComponent({
    name: "DesktopWatermark",
    inheritAttrs: false,
    setup() {
      return () =>
        h(Desktop, { icons: desktopIcons.value, onOpen: (id: WindowId) => auto.openWindow(id) });
    },
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) as any;

/**
 * Nothing docks into the grid: `false` disables the one drop target that can
 * create or split grid groups, which is what keeps the desktop uncovered.
 */
const dndEdges = false;

/* ---------------------------------- banner --------------------------------- */

/** Cleared on dismiss; a newer error re-arms it. */
const dismissed = ref<string | null>(null);
const banner = computed(() => {
  if (ts.reconnecting && ts.hubState !== "open") return t("banner.reconnecting");
  // A TeamSpeak-side drop retries a few times on its own; say so, with the
  // count, rather than showing the raw error as if nothing were happening.
  if (ts.retryPending) {
    return t("banner.retrying", { n: String(ts.retryAttempt), max: String(ts.retryMax) });
  }
  const err = ts.lastError;
  if (!err || err === dismissed.value) return null;
  return err;
});
/** After a reconnect, the camera is offered rather than silently re-enabled. */
const showResumeCamera = computed(() => rtc.cameraResumeOffered && ts.connState === "connected");
// Offer the button only for a TeamSpeak-side drop: while the gateway link
// itself is down the connection layer is already retrying on its own.
const showReconnect = computed(() => ts.reconnecting && ts.hubState === "open");

/**
 * The hub was updated under this tab: its page code is older than the hub it
 * talks to. Reloading is the user's call, since it drops voice for a moment.
 */
const staleDismissed = ref(false);
const showStaleBuild = computed(() => ts.pageIsStale && !staleDismissed.value);

function reloadPage(): void {
  location.reload();
}

function dismissBanner(): void {
  dismissed.value = ts.lastError;
}

/** The connect click is a user gesture: start the AudioContext right away. */
function onConnectGesture(): void {
  void voice.start().catch(() => undefined);
}

/* --------------------------------- desktop --------------------------------- */

/**
 * Like TS3, the chat of the channel you are in is opened in the background.
 *
 * The store fills its channels in the same tick it goes `connected`, so
 * `useAutoWindows`'s watcher fires before dockview exists and never again;
 * building the desktop is the point where that chat can actually be opened.
 */
function openSelfChannelChat(api: DockviewApi): void {
  const id = ts.selfChannel?.id;
  if (!id) return;
  if (api.getPanel(CHAT + `channel:${id}`)) return;
  auto.openConversation(`channel:${id}`, false);
}

/** Opens the windows a new user starts with. Returns false if it could not. */
function buildStarterDesktop(api: DockviewApi): boolean {
  const size = desktop.desktopSize();
  // A 0x0 dock has no room for anything; `onReady`'s relayout tries again.
  if (!size) return false;
  const features = {
    video: ts.features.video,
    music: desktopIcons.value.includes("music"),
    files: !!ts.features.files,
  };
  for (const win of starterDesktop(features, size)) {
    openFloatingWindow(api, win.panelId, {
      component: win.id === "chat" ? "chat" : win.id,
      title: auto.titleOf(win.id),
      params: win.id === "chat" ? { conversation: "server" } : undefined,
      box: win.box,
    });
    // These windows are placed, not cascaded; step the cascade past them so the
    // first window opened from an icon does not land under the tree.
    desktop.nextCascade();
  }
  openSelfChannelChat(api);
  return true;
}

/**
 * The window a clicked header control belongs to, as the id of its front tab.
 *
 * Deliberately *not* `api.activePanel`: dockview activates a group from
 * `pointerdown` on its tab container or its void container only, and the
 * right-hand actions container these buttons live in is a sibling of both. The
 * clicked window is therefore active only because Chromium focuses a `<button>`
 * on click and dockview's focus tracker notices — which Safari and
 * Firefox-on-macOS do not do, so there the control would act on whichever
 * window happened to be active before. Walking up to the group's own element
 * makes the target the window the user actually clicked, on every browser.
 */
function controlTarget(api: DockviewApi, button: HTMLElement): string | undefined {
  const groupElement = button.closest(".dv-groupview");
  const panel = groupElement
    ? api.panels.find((p) => p.group?.element === groupElement)
    : undefined;
  // A control acts on the tab in front of that window; falling back to the
  // active panel keeps the buttons working if dockview ever renames the class.
  return panel?.group?.activePanel?.id ?? panel?.id ?? api.activePanel?.id;
}

function onReady(event: DockviewReadyEvent): void {
  const api = event.api;
  desktop.attach(api);
  // A tab dropped anywhere that is not a tab bar becomes its own window: on
  // another window's content, or on the empty desktop behind the windows.
  // With no grid, that is the only way to un-stack one.
  // A torn-out tab goes back to the window it had before it was stacked, which
  // is the desktop's to remember; see `tearOutBox`.
  const remembered = (panelId: string) => desktop.floatBoxOf(panelId);
  // A tab the drag rested on a window's edge splits that window instead of
  // tearing out under the pointer; `tabDrop` is what watched the drag and knows
  // whether anything is armed for the window being dropped on.
  // Anywhere else, a snap the drag rested on puts the window in its box.
  installFloatOnDrop(api, () => document.querySelector<HTMLElement>(".dock"), remembered, {
    armed: (group) => tabDrop.armedFor(group),
    landing: (panelId) => tabDrop.landingFor(panelId),
    moveTo: (panelId, box) => desktop.snapTo(panelId, box),
  });
  installDesktopFloatOnDrop(api, () => document.querySelector<HTMLElement>(".dock"), {
    remembered,
    landing: (panelId) => tabDrop.landingFor(panelId),
    // A tab alone in its window is not torn out — the window itself moves to
    // the drop point, which the desktop records and saves.
    moveTo: (panelId, box) => desktop.snapTo(panelId, box),
  });
  // dockview constructs the header actions itself, so their events cannot be
  // bound in the template; the two window controls are delegated here.
  const root = document.querySelector<HTMLElement>(".dock");
  // The tab-drag watcher needs the dock root as well: a `dragover` that reaches
  // it without reaching a window is a drag over the empty desktop, which snaps
  // like any other landing, or over nothing that takes a drop, which ends the
  // wait. It lives as long as this dock does, and no longer: see
  // `tabDropInstalled` for why that matters.
  tabDropInstalled?.dispose();
  tabDropInstalled = root ? tabDrop.install(api, root) : null;
  root?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      "[data-testid=dock-minimize], [data-testid=dock-maximize]",
    );
    if (!button) return;
    const panelId = controlTarget(api, button);
    if (!panelId) return;
    if (button.dataset.testid === "dock-minimize") desktop.minimize(panelId);
    else desktop.toggleMaximize(panelId);
  });
  // Hovering a maximise button opens the Snap Layouts flyout. The same
  // constraint applies as to the clicks above — dockview builds the header, so
  // nothing there can be bound from this template — and the window is resolved
  // the same way, by walking up to its `.dv-groupview`, not via `activePanel`.
  const wrap = document.querySelector<HTMLElement>(".dock-wrap");
  if (wrap) snapLayouts.install(api, wrap, (button) => controlTarget(api, button));
  const saved = localStorage.getItem(LAYOUT_KEY);
  let restored = false;
  if (saved) {
    try {
      api.fromJSON(withoutPanelRenderers(JSON.parse(saved)) as Parameters<typeof api.fromJSON>[0]);
      // Private chats are keyed by client id, which the server reuses across
      // sessions, so a restored `chat:client:<id>` panel would point at whoever
      // holds that id now. Channel ids are per server too.
      for (const p of [...api.panels]) {
        const conv = p.id.startsWith(CHAT) ? p.id.slice(CHAT.length) : "";
        const staleClient = conv.startsWith("client:");
        const staleChannel =
          conv.startsWith("channel:") && !ts.channels.has(conv.slice("channel:".length));
        if (staleClient || staleChannel) api.removePanel(p);
      }
      restored = api.panels.length > 0;
    } catch {
      restored = false;
    }
  }
  if (!restored) buildStarterDesktop(api);
  if (restored) {
    // A restored panel keeps the title dockview serialised, which may carry a
    // stale unread count or predate a language change.
    auto.refreshChatTitles();
    openSelfChannelChat(api);
  }
  // A layout saved against a hub that had a music bot keeps the window; without
  // one it can only ever say "unavailable", so drop it.
  if (restored && !desktopIcons.value.includes("music")) {
    const panel = api.getPanel("music");
    if (panel) api.removePanel(panel);
  }
  api.onDidLayoutChange(() => desktop.saveLayout());
  api.onDidRemovePanel((removed) => desktop.forget(removed.id));
  api.onDidActivePanelChange((e) => {
    const id = e.panel?.id;
    // dockview's active-panel event replays: subscribing after `fromJSON` has
    // restored the layout immediately re-delivers the restored active panel,
    // which can be a chat that was minimised when it was saved. A minimised
    // window is never the one in front, and opening its conversation would
    // bring it straight back to the front — the same rule the taskbar uses.
    if (!id?.startsWith(CHAT) || desktop.isMinimized(id)) return;
    ts.openConversation(id.slice(CHAT.length));
  });
  // dockview computes pixel sizes at init; its container can still be 0-height
  // on the first frame, so force a re-layout once the flexbox has settled.
  const relayout = () => {
    const el = document.querySelector<HTMLElement>(".dock");
    if (el) api.layout(el.clientWidth, el.clientHeight, true);
    // The dock may have been 0x0 when the starter desktop was built, leaving it
    // empty; now that it has a box, build it. Only ever while there is nothing
    // to overwrite, so this cannot run twice over the user's windows.
    if (api.panels.length === 0) buildStarterDesktop(api);
  };
  requestAnimationFrame(relayout);
  setTimeout(relayout, 60);
}

function resetLayout(): void {
  desktop.resetDesktop(buildStarterDesktop);
}
</script>

<template>
  <div class="shell">
    <!--
      Connection trouble is otherwise only visible in the log console, which is
      closed by default; the banner is the one place the user reliably sees it.
    -->
    <div v-if="banner" class="banner" :class="{ busy: ts.reconnecting }" role="status">
      <span class="banner-text">{{ banner }}</span>
      <button v-if="showReconnect" class="banner-action" @click="ts.reconnect()">
        {{ t("banner.reconnect") }}
      </button>
      <!-- Nothing to dismiss while the retry is in flight: it would come right back. -->
      <button
        v-if="!ts.reconnecting || ts.hubState === 'open'"
        class="banner-close"
        :title="t('banner.dismiss')"
        @click="dismissBanner"
      >
        ×
      </button>
    </div>
    <!--
      Its own bar: the camera offer outlives the reconnect banner, which clears
      as soon as the session is back.
    -->
    <div v-if="showStaleBuild" class="banner" role="status">
      <span class="banner-text">{{ t("banner.staleBuild") }}</span>
      <button class="banner-action" @click="reloadPage">{{ t("banner.reload") }}</button>
      <button class="banner-close" :title="t('banner.dismiss')" @click="staleDismissed = true">
        ×
      </button>
    </div>
    <div v-if="showResumeCamera" class="banner" role="status">
      <span class="banner-text">{{ t("video.cameraOffPrompt") }}</span>
      <button class="banner-action" @click="rtc.resumeCamera()">
        {{ t("banner.resumeCamera") }}
      </button>
      <button class="banner-close" :title="t('banner.dismiss')" @click="rtc.dismissCameraResume()">
        ×
      </button>
    </div>
    <Taskbar
      v-if="ts.connState === 'connected' && !isMobile"
      :buttons="desktop.buttons.value"
      @activate="desktop.clickTaskbar($event)"
      @minimize-all="desktop.toggleShowDesktop()"
      @close="desktop.api.value?.getPanel($event)?.api.close()"
    />
    <div class="dock-wrap">
      <template v-if="ts.connState === 'connected'">
        <MobileShell v-if="isMobile" />
        <template v-else>
          <!--
            `floating-group-drag-handle="tabbar"` moves a floating window by the
            empty space of its own tab bar, the way a real window's title area
            works. The other mode, `titlebar`, renders a dedicated blank bar
            above the tabs — a second empty strip on top of every window.

            `default-renderer="always"` is what stops moving a tab in or out of
            a tab bar from destroying it. dockview's default, `onlyWhenVisible`,
            tears a panel's content down whenever it is not the visible tab and
            builds it again afterwards, so stacking a window reloaded its
            iframes, restarted its video and lost what was typed but not sent.
            With `always` every panel is rendered once, into one shared overlay
            positioned over its group, and stacking or tearing out only moves
            the frame the overlay follows: nothing is killed, things are hidden.
            Minimising had to learn the same trick — see `applyMinimized`.
          -->
          <DockviewVue
            class="dock dockview-theme-abyss"
            :components="dockComponentsRaw"
            :right-header-actions-component="headerActions"
            :watermark-component="desktopComponent"
            :theme="DOCK_THEME"
            :dnd-edges="dndEdges"
            :transform-floating-group-drag="desktop.dragTransform"
            :floating-group-drag-handle="'tabbar'"
            :default-renderer="'always'"
            :floating-group-bounds="'boundedWithinViewport'"
            @ready="onReady"
          />
          <SnapOverlay :box="desktop.snapPreview.value" :dwelling="desktop.snapDwelling.value" />
          <SnapLayouts
            v-if="showSnapLayouts"
            :anchor="snapLayoutsAnchor"
            @pick="(layoutId, zoneId) => snapLayouts.pick(layoutId, zoneId)"
            @hold="snapLayouts.hold()"
            @release="snapLayouts.release()"
            @close="snapLayouts.close()"
          />
        </template>
      </template>
      <ConnectDialog v-else-if="access.state === 'open'" @submit="onConnectGesture" />
      <HubLogin v-else />
    </div>
    <!-- The mobile shell carries its own voice bar and settings sheet. -->
    <StatusBar v-if="!isMobile" class="status" @reset-layout="resetLayout">
      <template #voice>
        <VoiceControls />
      </template>
    </StatusBar>
  </div>

  <div v-if="ts.showLog" class="log-float glass">
    <LogConsole />
  </div>

  <!-- Opened from the status-bar gear, or on a phone from the voice bar and the menu. -->
  <SettingsPanel v-if="settingsOpen" />
  <ContextMenu />
  <!-- Renders `confirmDialog()` prompts from anywhere in the app. -->
  <ConfirmHost />
  <FilePasswordHost />
  <HostMessageDialog />
  <ClientDialogsHost />
  <MediaViewerHost />
</template>

<style scoped>
.shell {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.dock-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  /* dockview puts its sashes at z-index ~999; keep that inside the dock so
     dialogs and status-bar popovers are not cut through by a resize handle. */
  isolation: isolate;
  /* The desktop is the frame: anything dockview lets hang outside it is cut
     off here rather than growing the document and scrolling the whole page.
     This is the right box for it — the taskbar, the status bar and its
     popovers, the settings panel and every dialog host live outside it, and
     what is inside (the dock, the mobile shell, the connect dialog) already
     fills it exactly. */
  overflow: hidden;
}
.banner {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--danger) 18%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 45%, transparent);
  font-size: 12px;
}
.banner.busy {
  background: color-mix(in srgb, var(--warn) 18%, transparent);
  border-bottom-color: color-mix(in srgb, var(--warn) 45%, transparent);
}
.banner-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.banner-action,
.banner-close {
  flex: none;
  background: transparent;
  border: 1px solid var(--border);
  color: inherit;
  border-radius: 4px;
  cursor: pointer;
  padding: 2px 8px;
}
.banner-close {
  padding: 2px 6px;
  border-color: transparent;
  font-size: 14px;
  line-height: 1;
}
.banner-action:hover,
.banner-close:hover {
  background: color-mix(in srgb, currentColor 14%, transparent);
}
.status {
  flex: none;
}
.log-float {
  position: fixed;
  right: 16px;
  bottom: 60px;
  width: min(620px, 94vw);
  height: min(360px, 60vh);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 16px 50px rgba(0, 0, 0, 0.55);
  z-index: 50;
}
</style>

<style>
/* dockview's root must fill the wrapper; scoped styles don't reach it reliably. */
.dock.dockview-theme-abyss {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
}
/*
 * dockview repeats the theme class on its inner `.dv-shell`, which re-declares
 * the abyss colours there; the overrides have to sit on both elements or the
 * panels never see the app's (themeable) palette.
 */
.dock.dockview-theme-abyss,
.dock .dockview-theme-abyss {
  /* Transparent so the theme's page background shows between the windows. */
  --dv-background-color: transparent;
  --dv-group-view-background-color: var(--bg-elev);
  --dv-tabs-and-actions-container-background-color: var(--bg);
  --dv-activegroup-visiblepanel-tab-background-color: var(--bg-elev);
  --dv-inactivegroup-visiblepanel-tab-background-color: var(--bg);
  --dv-activegroup-hiddenpanel-tab-background-color: transparent;
  --dv-inactivegroup-hiddenpanel-tab-background-color: transparent;
  --dv-tab-divider-color: var(--border);
  --dv-separator-border: var(--border);
  --dv-paneview-active-outline-color: var(--accent);
  --dv-icon-hover-background-color: var(--bg-elev-2);
}
.dock-fill {
  height: 100%;
  min-height: 0;
  display: flex;
}
.dock-fill > * {
  flex: 1;
  min-width: 0;
  min-height: 0;
}
</style>
