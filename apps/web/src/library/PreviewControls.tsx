import { Captions, CaptionsOff, Volume2, VolumeX } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

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

const percent = (fraction: number) => `${String(Math.min(1, Math.max(0, fraction)) * 100)}%`;

/**
 * The scrub bar: a 2rem band along the tile's bottom with the bar raised inside it, so a pointer
 * a little low is still on the tile. A press seeks there and a drag follows the pointer, which the
 * bar captures (the tile keeps playing even past its edge); one seek a frame, the knob ahead of
 * it. The browser's own link drag and text selection are kept out.
 */
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
  const track = useRef<HTMLDivElement>(null);
  /** The pointer dragging the bar, if one is. */
  const dragging = useRef<number | null>(null);
  const frame = useRef(0);
  /** Where a drag has the knob, ahead of the video catching up. */
  const [dragAt, setDragAt] = useState<number | null>(null);
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
    },
    [],
  );
  const seekTo = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    setDragAt(fraction);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      onSeek(fraction);
    });
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    keep(e);
    if (dragging.current !== e.pointerId) return;
    dragging.current = null;
    setDragAt(null);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const played = dragAt ?? (duration > 0 ? at / duration : 0);
  return (
    <div
      data-scrub-bar
      data-dragging={dragAt === null ? undefined : ""}
      onPointerDown={(e) => {
        e.preventDefault();
        keep(e);
        dragging.current = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging.current === e.pointerId) seekTo(e.clientX);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDragStart={(e) => {
        e.preventDefault();
      }}
      onClick={own}
      className="group/scrub pointer-events-auto absolute inset-x-0 bottom-0 z-10 flex h-8 cursor-pointer touch-none items-end px-3 pb-2.5 select-none"
    >
      <div
        ref={track}
        data-scrub-track
        className="relative h-1 w-full rounded-full bg-white/35 transition-[height] group-hover/scrub:h-1.5 group-data-[dragging]/scrub:h-1.5 motion-reduce:transition-none"
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/50"
          style={{ width: percent(duration > 0 ? buffered / duration : 0) }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          style={{ width: percent(played) }}
        />
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary opacity-0 transition-opacity group-hover/scrub:opacity-100 group-data-[dragging]/scrub:opacity-100 motion-reduce:transition-none"
          style={{ left: percent(played) }}
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
