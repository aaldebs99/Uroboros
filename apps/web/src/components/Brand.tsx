/** The mark and wordmark. `/uroboros.svg` is a copy of `assets/logos/uroboros-transparent.svg`. */
export function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-xl bg-[oklch(0.95_0.025_250)] shadow-[0_0_16px_oklch(0.62_0.19_262/0.4)] ring-1 ring-white/30">
        <img src="/uroboros.svg" alt="" className="size-7" />
      </span>
      <span className="font-display text-xl font-semibold tracking-tight">Uroboros</span>
    </div>
  );
}
