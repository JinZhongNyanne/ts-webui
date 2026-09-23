/**
 * Page-level hotkey listeners. Call once from the app shell.
 *
 * Browsers only deliver key and mouse events to a focused page, so these are
 * "while the tab is in front" hotkeys; a global push-to-talk would need a
 * native helper. Holds are therefore released whenever the page loses focus
 * or is hidden — otherwise alt-tabbing away mid-sentence would leave the mic
 * open, because the key-up happens somewhere we never hear about.
 */
import { useTsStore } from "../stores/ts";
import { useVoiceStore } from "../stores/voice";
import {
  HOLD_ACTIONS,
  HOTKEY_ACTIONS,
  useHotkeysStore,
  type HotkeyAction,
} from "../stores/hotkeys";
import {
  comboFromMouse,
  isModifierCode,
  isTypingTarget,
  matchesPress,
  matchesRelease,
  parseCombo,
  type KeyLike,
  type MouseLike,
} from "./combo";

let installed = false;

export function useHotkeys(): void {
  if (installed) return;
  installed = true;
  const ts = useTsStore();
  const voice = useVoiceStore();
  const hotkeys = useHotkeysStore();

  function run(action: HotkeyAction): void {
    const me = ts.selfClient;
    if (!me || ts.connState !== "connected") return;
    if (action === "toggleMic") ts.setInputMuted(!me.inputMuted);
    else if (action === "toggleSpeakers") ts.setOutputMuted(!me.outputMuted);
    else if (action === "toggleAway") ts.setAway(!me.away);
  }

  function hold(action: HotkeyAction, down: boolean): void {
    if (action === "ptt") voice.pttPressed = down && voice.mode === "ptt";
    // Whispering works in either transmit mode, like TeamSpeak's whisper keys.
    else if (action === "whisper") voice.whisperPressed = down;
  }

  function releaseAll(): void {
    for (const action of HOLD_ACTIONS) hold(action, false);
  }

  function activeActions(): {
    action: HotkeyAction;
    combo: NonNullable<ReturnType<typeof parseCombo>>;
  }[] {
    const out = [];
    for (const action of HOTKEY_ACTIONS) {
      // Outside PTT mode the key is just a key: claiming it would stop Space
      // or Enter from pressing buttons in every dialog.
      if (action === "ptt" && voice.mode !== "ptt") continue;
      const combo = parseCombo(hotkeys.bindings[action]);
      if (combo) out.push({ action, combo });
    }
    return out;
  }

  /** Returns true when the press was ours, so the caller suppresses the default. */
  function onPress(ev: KeyLike | MouseLike, repeat: boolean): boolean {
    if (hotkeys.recording) return false;
    const typing = isTypingTarget(document.activeElement as HTMLElement | null);
    let handled = false;
    for (const { action, combo } of activeActions()) {
      const isHold = HOLD_ACTIONS.has(action);
      if (!matchesPress(combo, ev, isHold)) continue;
      if (typing && !(action === "ptt" && hotkeys.pttWhileTyping)) continue;
      // Typing with PTT allowed: transmit, but let the character through too.
      if (!typing && !isModifierCode(combo.key)) handled = true;
      if (isHold) hold(action, true);
      else if (!repeat) run(action);
    }
    return handled;
  }

  function onRelease(ev: KeyLike | MouseLike): boolean {
    let handled = false;
    for (const { action, combo } of activeActions()) {
      if (!HOLD_ACTIONS.has(action) || !matchesRelease(combo, ev)) continue;
      hold(action, false);
      handled = true;
    }
    return handled;
  }

  /** Bound side buttons must not also navigate back / forward, nor middle autoscroll. */
  function boundMouse(ev: MouseEvent): boolean {
    if (hotkeys.recording || !comboFromMouse(ev)) return false;
    return activeActions().some(({ combo }) => matchesRelease(combo, ev));
  }

  window.addEventListener("keydown", (ev) => {
    if (onPress(ev, ev.repeat)) ev.preventDefault();
  });
  window.addEventListener("keyup", (ev) => {
    onRelease(ev);
  });
  window.addEventListener("mousedown", (ev) => {
    if (!comboFromMouse(ev)) return;
    onPress(ev, false);
    if (boundMouse(ev)) ev.preventDefault();
  });
  window.addEventListener("mouseup", (ev) => {
    if (!comboFromMouse(ev)) return;
    onRelease(ev);
    if (boundMouse(ev)) ev.preventDefault();
  });
  // Chrome navigates on the side buttons' auxclick; Firefox on mouseup.
  window.addEventListener("auxclick", (ev) => {
    if (boundMouse(ev)) ev.preventDefault();
  });
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") releaseAll();
  });
}
