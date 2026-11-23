const KEY = "uroboros.returnTo";

/** A same-origin path, or `/`. */
export function safePath(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") ? value : "/";
}

/** Remembers where to come back to after signing in (this tab only). */
export function saveReturnTo(path: string): void {
  try {
    sessionStorage.setItem(KEY, safePath(path));
  } catch {
    // Storage refused: signing in lands on the start page.
  }
}

/** The saved path, once; `/` when none. */
export function takeReturnTo(): string {
  try {
    const saved = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return saved === null ? "/" : safePath(saved);
  } catch {
    return "/";
  }
}

/** Where the browser is now, as a path to return to. */
export function currentPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}
