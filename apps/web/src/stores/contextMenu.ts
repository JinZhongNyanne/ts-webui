import { ref } from "vue";
import { defineStore } from "pinia";

export interface MenuItem {
  label?: string;
  icon?: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** A stable handle for tests, when the label is translated. */
  testId?: string;
  /** Render a divider instead of an item. */
  separator?: boolean;
}

/**
 * What `show` needs from the event that anchors the menu. A `MouseEvent`
 * satisfies it; so does the adapter a long press builds on touch devices, which
 * have no `contextmenu` event at all.
 */
export interface MenuAnchorEvent {
  readonly clientX: number;
  readonly clientY: number;
  preventDefault(): void;
  stopPropagation(): void;
}

export const useContextMenu = defineStore("contextMenu", () => {
  const open = ref(false);
  const x = ref(0);
  const y = ref(0);
  const items = ref<MenuItem[]>([]);
  const title = ref("");

  function show(ev: MenuAnchorEvent, menuItems: MenuItem[], menuTitle = ""): void {
    ev.preventDefault();
    ev.stopPropagation();
    const filtered = menuItems.filter(Boolean);
    if (filtered.length === 0) return;
    items.value = filtered;
    title.value = menuTitle;
    // The component measures the rendered menu and clamps it to the viewport.
    x.value = ev.clientX;
    y.value = ev.clientY;
    open.value = true;
  }

  function close(): void {
    open.value = false;
    items.value = [];
    title.value = "";
  }

  function run(item: MenuItem): void {
    if (item.disabled || item.separator) return;
    close();
    item.action?.();
  }

  return { open, x, y, items, title, show, close, run };
});
