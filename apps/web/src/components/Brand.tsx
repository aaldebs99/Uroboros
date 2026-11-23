import { Link } from "@tanstack/react-router";

/**
 * The mark and wordmark. `/uroboros-tile.svg` is a copy of `assets/logos/uroboros.svg`, the logo
 * on its own navy tile (refreshed by `mise run icons`), the only navy element in light mode. With
 * `home` (the top bar and the navigation drawer) it is a link to the library, the start page,
 * dropping any search or filter; without it (sign-in, a public link) it is only the mark.
 */
export function Brand({ home = false }: { home?: boolean }) {
  const mark = (
    <>
      <img
        src="/uroboros-tile.svg"
        alt=""
        className="size-7 rounded-[18.5%] shadow-[0_0_0.875rem_oklch(0.62_0.19_262/0.35)] md:size-8"
      />
      <span className="text-base font-bold md:text-lg">Uroboros</span>
    </>
  );
  if (!home) return <div className="flex items-center gap-2.5">{mark}</div>;
  return (
    <Link
      to="/"
      aria-label="Uroboros, go to the library"
      className="flex items-center gap-2.5 rounded-[0.625rem] outline-none focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
    >
      {mark}
    </Link>
  );
}
