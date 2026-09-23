/**
 * The ways a file gets into a chat composer: the attach button (a hidden
 * file input), dropping files onto the chat, and pasting (a screenshot, or
 * files copied in the OS). Each file goes to the chatUploads store.
 */
import { computed, ref, type Ref } from "vue";
import { useTsStore } from "../../stores/ts";
import { useChatUploadsStore } from "../../stores/chatUploads";

/** Whether a drag carries files (and not, say, selected text or a client from the tree). */
function hasFiles(ev: DragEvent): boolean {
  return [...(ev.dataTransfer?.types ?? [])].includes("Files");
}

export function useChatFileInput(conversation: Ref<string>) {
  const ts = useTsStore();
  const uploads = useChatUploadsStore();
  const picker = ref<HTMLInputElement | null>(null);
  const dragging = ref(false);
  /** Nested elements fire enter/leave pairs of their own; count them. */
  let depth = 0;

  /** The hub must do file transfer (older hubs don't) and we must be connected. */
  const enabled = computed(() => ts.connState === "connected" && !!ts.features.files);

  function send(files: Iterable<File>, pasted = false): void {
    if (!enabled.value) return;
    uploads.attach(conversation.value, files, pasted);
  }

  function pick(): void {
    picker.value?.click();
  }

  function onPicked(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    send(Array.from(input.files ?? []));
    // Picking the same file again must fire `change` again.
    input.value = "";
  }

  function onDragEnter(ev: DragEvent): void {
    if (!enabled.value || !hasFiles(ev)) return;
    ev.preventDefault();
    depth++;
    dragging.value = true;
  }

  function onDragOver(ev: DragEvent): void {
    if (!enabled.value || !hasFiles(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
  }

  function onDragLeave(ev: DragEvent): void {
    if (!hasFiles(ev)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging.value = false;
  }

  function onDrop(ev: DragEvent): void {
    depth = 0;
    dragging.value = false;
    if (!enabled.value || !hasFiles(ev)) return;
    ev.preventDefault();
    send(Array.from(ev.dataTransfer?.files ?? []));
  }

  /** Pasted files are sent; pasted text is left to the input. */
  function onPaste(ev: ClipboardEvent): void {
    const pasted = Array.from(ev.clipboardData?.files ?? []);
    if (!enabled.value || pasted.length === 0) return;
    ev.preventDefault();
    // A screenshot comes as "image.png" (or nameless); files copied in the OS keep their names.
    for (const file of pasted) send([file], !file.name || /^image\.\w+$/i.test(file.name));
  }

  return {
    picker,
    dragging,
    enabled,
    pick,
    onPicked,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    onPaste,
  };
}
