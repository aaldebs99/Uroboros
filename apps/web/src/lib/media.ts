import { useSyncExternalStore } from "react";

/** The design system's one breakpoint, `md` (48rem). */
export const DESKTOP_QUERY = "(min-width: 48rem)";

function matches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/** Whether a media query matches, kept current. False where `matchMedia` is missing (jsdom). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => undefined;
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => {
        media.removeEventListener("change", onChange);
      };
    },
    () => matches(query),
    () => false,
  );
}
