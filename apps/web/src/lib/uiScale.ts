import { useCallback, useSyncExternalStore } from "react";

/**
 * The UI's size knob (index.css): `--ui-scale` on the root multiplies its font size, and every size
 * in the app is rem, so the whole UI follows. The account menu's Size picks it, per device, in
 * localStorage. public/theme-init.js applies it before first paint: keep the two in sync
 * (uiScale.test.ts checks they agree).
 */
export const UI_SCALE_KEY = "uroboros-ui-scale";
export const UI_SCALE_STEPS = [0.9, 1, 1.1, 1.25] as const;
export type UiScale = (typeof UI_SCALE_STEPS)[number];
export const UI_SCALE_DEFAULT: UiScale = 1;

const listeners = new Set<() => void>();

export function isUiScale(value: number): value is UiScale {
  return (UI_SCALE_STEPS as readonly number[]).includes(value);
}

/** The saved size; the default when nothing (or junk) is saved, or storage is unavailable. */
export function readStoredUiScale(): UiScale {
  try {
    const value = Number(localStorage.getItem(UI_SCALE_KEY));
    return isUiScale(value) ? value : UI_SCALE_DEFAULT;
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

/** Saves the size; the default is saved as nothing, so a later default change reaches it. */
export function storeUiScale(scale: UiScale): void {
  try {
    if (scale === UI_SCALE_DEFAULT) localStorage.removeItem(UI_SCALE_KEY);
    else localStorage.setItem(UI_SCALE_KEY, String(scale));
  } catch {
    // Private windows and blocked storage: the size just won't outlive the tab.
  }
}

export function applyUiScale(scale: UiScale): void {
  document.documentElement.style.setProperty("--ui-scale", String(scale));
}

function changed(): void {
  applyUiScale(readStoredUiScale());
  listeners.forEach((notify) => {
    notify();
  });
}

/**
 * Applies the saved size (theme-init.js already did, before first paint) and follows changes made
 * in other tabs, re-applying the variable there too, not only re-rendering. From `main.tsx`.
 */
export function initUiScale(): void {
  applyUiScale(readStoredUiScale());
  window.addEventListener("storage", (e) => {
    if (e.key === UI_SCALE_KEY || e.key === null) changed();
  });
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useUiScale(): { scale: UiScale; choose: (scale: UiScale) => void } {
  const scale = useSyncExternalStore(subscribe, readStoredUiScale, () => UI_SCALE_DEFAULT);
  const choose = useCallback((next: UiScale) => {
    storeUiScale(next);
    changed();
  }, []);
  return { scale, choose };
}
