import { useEffect, useState } from "react";

/** Where the page's keys belong to something else: a dialog, the nav drawer, a menu, a list. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], dialog, [role="menu"], [role="listbox"]';

/**
 * Whether the focus is somewhere the page-wide shortcuts must leave alone: inside an overlay (where
 * a letter is the menu's typeahead and Space a dialog's). Rechecked as the focus moves; on a blur
 * after the change, since a dialog that unmounts can drop the focus to the body without a focusin.
 */
export function useFocusInOverlay(): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const check = () => {
      setInside(document.activeElement?.closest(OVERLAY) != null);
    };
    const later = () => {
      window.setTimeout(check, 0);
    };
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return inside;
}
