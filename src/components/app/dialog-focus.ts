"use client";

import { useEffect, useEffectEvent, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** The dialogs open right now, newest last: only the top one answers Escape and Tab. */
const stack: symbol[] = [];

/**
 * Where Tab should send focus inside a dialog, or null to let the browser move it as usual. Focus
 * outside the list (or nowhere) comes back in at the first item, or the last going backwards.
 */
export function wrapFocus<T>(items: readonly T[], active: T | null, back: boolean): T | null {
  if (!items.length) return null;
  const at = active == null ? -1 : items.indexOf(active);
  if (at === -1) return back ? items[items.length - 1] : items[0];
  if (back && at === 0) return items[items.length - 1];
  if (!back && at === items.length - 1) return items[0];
  return null;
}

/**
 * A modal's keyboard manners, for as long as the element in `ref` is mounted: focus moves in (to
 * the control marked `data-autofocus`, else the first one), Tab and Shift+Tab stay inside, Escape
 * closes, and on close focus goes back to whatever opened it.
 */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, onClose: () => void, active = true) {
  const close = useEffectEvent(onClose);

  useEffect(() => {
    const node = active ? ref.current : null;
    if (!node) return;
    const id = Symbol("dialog");
    stack.push(id);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
    (node.querySelector<HTMLElement>("[data-autofocus]") ?? items()[0] ?? node).focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (stack[stack.length - 1] !== id || event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const active = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
      const available = items();
      const target = wrapFocus(available, active, event.shiftKey) ?? (available.length ? null : node);
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const at = stack.indexOf(id);
      if (at !== -1) stack.splice(at, 1);
      // Back to the opener, unless focus has already gone somewhere on purpose or the opener is gone.
      const now = document.activeElement;
      if (opener?.isConnected && (!now || now === document.body || node.contains(now))) opener.focus({ preventScroll: true });
    };
  }, [ref, active]);
}
