import { Captions, CaptionsOff, Volume2, VolumeX } from "lucide-react";
import { useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";

/**
 * A preview's controls over the playing tile (docs/library.md "Hover previews"): sound and, below
 * it, captions in the top right, and a scrub bar along the bottom. They belong to the preview, not
 * the tile: a press never reaches the tile's link or its press-and-hold.
 */

const keep = (e: PointerEvent | MouseEvent) => {
  e.stopPropagation();
};
const own = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

function ControlButton({
  label,
  pressed,
  onPress,
  children,
}: {
  label: string;
  pressed: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      aria-pressed={pressed}
      onPointerDown={keep}
      onPointerUp={keep}
      onClick={(e) => {
        own(e);
        onPress();
      }}
      // 2rem to see, 2.75rem to hit.
      className="relative grid size-8 place-items-center rounded-full bg-overlay text-overlay-foreground transition-colors after:absolute after:-inset-1.5 hover:bg-overlay/80 focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

const percent = (part: number, whole: number) =>
  `${String(whole > 0 ? Math.min(100, (part / whole) * 100) : 0)}%`;

function ScrubBar({
  at,
  duration,
  buffered,
  onSeek,
}: {
  at: number;
  duration: number;
  buffered: number;
  onSeek: (fraction: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const seekTo = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return;
    onSeek(Math.min(1, Math.max(0, (clientX - box.left) / box.width)));
  };
  return (
    <div
      ref={bar}
      data-scrub-bar
      onPointerDown={(e) => {
        keep(e);
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0) seekTo(e.clientX);
      }}
      onPointerUp={(e) => {
        keep(e);
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onClick={own}
      className="group/scrub pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex h-3 cursor-pointer items-end"
    >
      <div className="relative h-1 w-full bg-white/35 transition-[height] group-hover/scrub:h-1.5 motion-reduce:transition-none">
        <div
          className="absolute inset-y-0 left-0 bg-white/50"
          style={{ width: percent(buffered, duration) }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: percent(at, duration) }}
        />
      </div>
    </div>
  );
}

export interface PreviewControlsProps {
  muted: boolean;
  onSound: () => void;
  /** Whether a caption track is showing; undefined when the video has no subtitles. */
  captions: boolean | undefined;
  onCaptions: () => void;
  /** Seconds played and buffered, of the whole. */
  at: number;
  buffered: number;
  duration: number;
  /** Seeks to a fraction of the whole. */
  onSeek: (fraction: number) => void;
}

export function PreviewControls(p: PreviewControlsProps) {
  return (
    <>
      <div className="pointer-events-auto absolute top-1.5 right-1.5 z-10 grid gap-1.5">
        <ControlButton label="Preview sound" pressed={!p.muted} onPress={p.onSound}>
          {p.muted ? (
            <VolumeX className="size-[1.125rem]" aria-hidden />
          ) : (
            <Volume2 className="size-[1.125rem]" aria-hidden />
          )}
        </ControlButton>
        {p.captions === undefined ? null : (
          <ControlButton label="Preview captions" pressed={p.captions} onPress={p.onCaptions}>
            {p.captions ? (
              <Captions className="size-[1.125rem]" aria-hidden />
            ) : (
              <CaptionsOff className="size-[1.125rem]" aria-hidden />
            )}
          </ControlButton>
        )}
      </div>
      <ScrubBar at={p.at} duration={p.duration} buffered={p.buffered} onSeek={p.onSeek} />
    </>
  );
}
