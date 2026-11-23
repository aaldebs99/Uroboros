/**
 * The mark and wordmark. `/uroboros-tile.svg` is a copy of `assets/logos/uroboros.svg`, the logo
 * on its own navy tile (refreshed by `mise run icons`); the ring and glow keep the tile's edge
 * visible on the navy sidebar.
 */
export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/uroboros-tile.svg"
        alt=""
        className="size-9 rounded-[18.5%] shadow-[0_0_16px_oklch(0.62_0.19_262/0.4)] ring-1 ring-white/30"
      />
      <span className="font-display text-xl font-semibold tracking-tight">Uroboros</span>
    </div>
  );
}
