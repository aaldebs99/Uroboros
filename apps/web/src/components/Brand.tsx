/**
 * The mark and wordmark. `/uroboros-tile.svg` is a copy of `assets/logos/uroboros.svg`, the logo
 * on its own navy tile (refreshed by `mise run icons`), the only navy element in light mode.
 */
export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <img
        src="/uroboros-tile.svg"
        alt=""
        className="size-7 rounded-[18.5%] shadow-[0_0_14px_oklch(0.62_0.19_262/0.35)] md:size-8"
      />
      <span className="text-base font-bold md:text-lg">Uroboros</span>
    </div>
  );
}
