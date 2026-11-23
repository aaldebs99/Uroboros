import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

export const STORAGE_KEY = "uroboros-theme";
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

/** Forgets the saved choice, so the device's setting decides again. */
export function clearStoredTheme(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Blocked storage held no choice to forget.
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

function changed(): void {
  applyTheme(currentTheme());
  listeners.forEach((notify) => {
    notify();
  });
}

/** What the person picked in Appearance: a theme, or "system" to follow the device. */
export type ThemeChoice = Theme | "system";

export function useThemeChoice(): { choice: ThemeChoice; choose: (choice: ThemeChoice) => void } {
  const choice = useSyncExternalStore(
    subscribe,
    () => readStoredTheme() ?? "system",
    () => "system" as const,
  );
  const choose = useCallback((next: ThemeChoice) => {
    if (next === "system") clearStoredTheme();
    else storeTheme(next);
    changed();
  }, []);
  return { choice, choose };
}

export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "light" as const);
  const toggle = useCallback(() => {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    storeTheme(next);
    changed();
  }, []);
  return { theme, toggle };
}
