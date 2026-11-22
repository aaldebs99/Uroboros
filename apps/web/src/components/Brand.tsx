/** The mark and wordmark. `/uroboros.svg` is a copy of `assets/logos/uroboros-transparent.svg`. */
export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/uroboros.svg"
        alt=""
        className="size-9 drop-shadow-[0_0_14px_oklch(0.62_0.19_262/0.55)]"
      />
      <span className="font-display text-xl font-semibold tracking-tight">Uroboros</span>
    </div>
  );
}
