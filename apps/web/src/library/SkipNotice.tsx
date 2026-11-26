import { useEffect, useState } from "react";

/** How long the notice stays after a skip, unless the viewer is pointing at it or focused on it. */
export const SKIP_NOTICE_MS = 4000;

/** One skip to tell the viewer about: a new id for each, so the next one gets its own time. */
export interface SkipNoticeContent {
  id: number;
  /** "Skipped sponsor" (skippedTitle). */
  title: string;
  /** Goes back to the skipped part and plays it through. */
  unskip: () => void;
}

/**
 * What the player just skipped (SponsorSkip): a small pill, "Skipped sponsor Unskip", at the
 * picture's bottom right, over the controls while they show (player.css), fullscreen too. The
 * whole pill is the Unskip button. It leaves 4 s later, never while the pointer is on it or it has
 * the focus. The region is always there, so a screen reader hears each skip.
 */
export function SkipNotice({
  notice,
  onDone,
}: {
  notice: SkipNoticeContent | null;
  /** The notice is over: time ran out, or Unskip was pressed. */
  onDone: () => void;
}) {
  return (
    <div
      role="status"
      aria-label="SponsorBlock"
      className="uro-skip-notice pointer-events-none absolute right-3 bottom-3 z-10"
    >
      {notice === null ? null : <Pill key={notice.id} notice={notice} onDone={onDone} />}
    </div>
  );
}

function Pill({ notice, onDone }: { notice: SkipNoticeContent; onDone: () => void }) {
  const [pointed, setPointed] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (pointed || focused) return;
    const timer = setTimeout(onDone, SKIP_NOTICE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [pointed, focused, onDone]);
  return (
    <button
      type="button"
      className="uro-skip-pill pointer-events-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-overlay px-3 text-xs text-overlay-foreground hover:bg-overlay/95 focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
      onPointerEnter={() => {
        setPointed(true);
      }}
      onPointerLeave={() => {
        setPointed(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      // The skin's own gestures (a tap toggles playback) never see a press meant for this.
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        notice.unskip();
        onDone();
      }}
    >
      {/* The space keeps the name "Skipped sponsor Unskip"; the flex gap does the spacing. */}
      {notice.title} <span className="font-semibold">Unskip</span>
    </button>
  );
}
