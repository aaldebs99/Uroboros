import { useEffect } from "react";

/** Ctrl+K, or ⌘K on a Mac: opens the search palette, or closes it again. */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.repeat &&
    event.key.toLowerCase() === "k"
  );
}

const onMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The shortcut as this platform's keyboard writes it, for the hint in the top bar's search. */
export const paletteHint = () => (onMac() ? "⌘K" : "Ctrl K");

/** A dialog, drawer or confirmation is open: the shortcut leaves it alone. */
const dialogOpen = () =>
  document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]') !== null;

/**
 * Listens for the palette's shortcut anywhere in the app, typing in a field included. It always
 * keeps the key from the browser (whose own Ctrl+K searches the web), then closes the palette if
 * it is open, or opens it unless something else holds the screen.
 */
export function usePaletteShortcut(open: boolean, setOpen: (open: boolean) => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isPaletteShortcut(event)) return;
      event.preventDefault();
      if (open) setOpen(false);
      else if (!dialogOpen()) setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [open, setOpen]);
}
