import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "uroboros-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

/** The saved choice, or `null` when there is none (or storage is unavailable). */
export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private windows and blocked storage: the choice just won't outlive the tab.
  }
}

export function resolveTheme(stored: Theme | null, systemDark: boolean): Theme {
  return stored ?? (systemDark ? "dark" : "light");
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches;
}

function currentTheme(): Theme {
  return resolveTheme(readStoredTheme(), systemPrefersDark());
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  const onSystemChange = () => {
    applyTheme(currentTheme());
    onChange();
  };
  media?.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(onChange);
    media?.removeEventListener("change", onSystemChange);
  };
}

/** Applies the saved or system theme before first paint; called once from `main.tsx`. */
export function initTheme(): void {
  applyTheme(currentTheme());
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    storeTheme(next);
    applyTheme(next);
    listeners.forEach((notify) => {
      notify();
    });
  }, []);
  return { theme, toggle };
}
