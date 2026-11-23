const KEY = "uroboros-nav-mini";

/** Whether the side navigation was left as the mini rail; false when storage is unavailable. */
export function readMini(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function storeMini(mini: boolean): void {
  try {
    localStorage.setItem(KEY, mini ? "1" : "0");
  } catch {
    // Blocked storage: the rail just won't outlive the tab.
  }
}
