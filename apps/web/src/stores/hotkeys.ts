import { computed, reactive, ref, watch } from "vue";
import { defineStore } from "pinia";
import { findConflicts, parseCombo, type Conflict } from "../hotkeys/combo";
import { useVoiceStore } from "./voice";

/**
 * Bindable actions. `whisper` is held to whisper to the whisper list (see
 * components/whisper); it sat reserved until whispering landed, so bindings
 * saved before then already have its slot.
 */
export const HOTKEY_ACTIONS = [
  "ptt",
  "toggleMic",
  "toggleSpeakers",
  "toggleAway",
  "whisper",
] as const;
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number];

/** Hold-to-activate actions: matched loosely and released on key-up. */
export const HOLD_ACTIONS: ReadonlySet<HotkeyAction> = new Set(["ptt", "whisper"]);

/** Pairs of bindable actions one press would set off together. */
export function hotkeyConflicts(
  bindings: Readonly<Record<HotkeyAction, string>>,
): Conflict<HotkeyAction>[] {
  return findConflicts(
    HOTKEY_ACTIONS.map((action) => ({
      action,
      combo: bindings[action],
      loose: HOLD_ACTIONS.has(action),
    })),
  );
}

interface PersistedHotkeys {
  bindings: Record<HotkeyAction, string>;
  /** Push-to-talk keeps working while a text field has focus. */
  pttWhileTyping: boolean;
}

const KEY = "jinz.hotkeys";

function load(legacyPttKey: string): PersistedHotkeys {
  const def: PersistedHotkeys = {
    // Before this store existed PTT lived in the voice settings as a bare
    // key code, which is already a valid combo string.
    bindings: { ptt: legacyPttKey, toggleMic: "", toggleSpeakers: "", toggleAway: "", whisper: "" },
    pttWhileTyping: false,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return def;
    const saved = JSON.parse(raw) as Partial<PersistedHotkeys>;
    const bindings = { ...def.bindings };
    for (const action of HOTKEY_ACTIONS) {
      const v = saved.bindings?.[action];
      if (typeof v === "string" && (v === "" || parseCombo(v))) bindings[action] = v;
    }
    return {
      bindings,
      pttWhileTyping:
        typeof saved.pttWhileTyping === "boolean" ? saved.pttWhileTyping : def.pttWhileTyping,
    };
  } catch {
    return def;
  }
}

export const useHotkeysStore = defineStore("hotkeys", () => {
  const voice = useVoiceStore();
  const saved = load(voice.pttKey);
  const bindings = reactive<Record<HotkeyAction, string>>({ ...saved.bindings });
  const pttWhileTyping = ref(saved.pttWhileTyping);
  /** The action whose binding is being recorded; hotkeys are paused meanwhile. */
  const recording = ref<HotkeyAction | null>(null);

  watch(
    [bindings, pttWhileTyping],
    () => {
      const data: PersistedHotkeys = {
        bindings: { ...bindings },
        pttWhileTyping: pttWhileTyping.value,
      };
      localStorage.setItem(KEY, JSON.stringify(data));
    },
    { deep: true },
  );
  // The voice store's old PTT field is still what older UI code and saved
  // settings read; keep it pointing at the same key.
  watch(
    () => bindings.ptt,
    (combo) => {
      voice.pttKey = combo;
    },
  );

  const conflicts = computed<Conflict<HotkeyAction>[]>(() => hotkeyConflicts(bindings));

  /** Actions that share a press with some other action. */
  const conflicted = computed(() => {
    const set = new Set<HotkeyAction>();
    for (const c of conflicts.value) {
      set.add(c.a);
      set.add(c.b);
    }
    return set;
  });

  function bind(action: HotkeyAction, combo: string): void {
    bindings[action] = combo;
  }

  function clear(action: HotkeyAction): void {
    bindings[action] = "";
  }

  return { bindings, pttWhileTyping, recording, conflicts, conflicted, bind, clear };
});
