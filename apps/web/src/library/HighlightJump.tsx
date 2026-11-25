import { Sparkles } from "lucide-react";
import { useEffect, useState, type RefObject } from "react";

/** Within this of the highlight, or past it, there is nothing left to jump to. */
const NEAR = 1;

/**
 * Jump to highlight (docs/automation.md#sponsorblock): while playback is short of the video's
 * SponsorBlock highlight, a pill in the player's top corner that goes there and plays. It shows and
 * hides with the controls (player.css), and its icon wears the highlight's color.
 */
export function HighlightJump({
  video,
  at,
  onJump,
}: {
  video: RefObject<HTMLVideoElement | null>;
  /** The highlight, in seconds. */
  at: number;
  onJump: (time: number) => void;
}) {
  const [short, setShort] = useState(true);
  useEffect(() => {
    const v = video.current;
    if (v === null) return;
    const look = () => {
      setShort(v.currentTime < at - NEAR);
    };
    look();
    v.addEventListener("timeupdate", look);
    v.addEventListener("seeked", look);
    return () => {
      v.removeEventListener("timeupdate", look);
      v.removeEventListener("seeked", look);
    };
  }, [video, at]);
  if (!short) return null;
  return (
    <button
      type="button"
      className="uro-highlight-jump absolute top-3 right-3 z-10 inline-flex min-h-11 items-center gap-2 rounded-full bg-overlay px-4 text-sm font-medium text-overlay-foreground focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none md:min-h-9 [&_svg]:size-4.5"
      // The skin's own gestures (a tap toggles playback) never see a press meant for this.
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onJump(at);
      }}
    >
      <Sparkles aria-hidden /> Jump to highlight
    </button>
  );
}
