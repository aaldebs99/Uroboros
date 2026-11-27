import { CLIP_MIN_SECONDS, type ClipRange } from "@uroboros/contract";
import { usePlayer } from "@videojs/react/video";
import { TimeSliderSlot } from "@videojs/react/video/time-slider-slot";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useRef,
} from "react";

import { formatDuration } from "@/downloads/format";

import { clipLabel, keyDelta, moveEnd, moveStart, percent } from "./clipRange";
import { PauseAtEnd } from "./PauseAtEnd";

/**
 * Picking a clip in the player (docs/sharing.md#clips): while the page has one picked (its Clip
 * button, beside Save and Share), its range on the timeline between two handles. A handle is a
 * slider of its own: dragged, or moved by key (the arrows a second, Shift or the page keys ten,
 * Home and End to the bounds), it never seeks the timeline or reaches the player's shortcuts;
 * Escape leaves clip mode. A range given only to show (a link that opens the whole video at a
 * clip) is drawn without handles.
 */

/** The clip the page holds, and how the player changes it (null: no clip picked). */
export interface ClipControl {
  value: ClipRange | null;
  onChange: (range: ClipRange | null) => void;
}

type Video = RefObject<HTMLVideoElement | null>;

/** The video's length once known, from the player's state. */
function useDuration(): number | null {
  const duration = usePlayer((s) => s.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

const stop = (e: { stopPropagation: () => void }) => {
  e.stopPropagation();
};

interface HandleProps {
  which: "start" | "end";
  range: ClipRange;
  duration: number;
  timeAt: (clientX: number) => number | null;
  onChange: (range: ClipRange | null) => void;
}

/** One end of the clip: a slider of its own, dragged or moved by key. */
function Handle({ which, range, duration, timeAt, onChange }: HandleProps) {
  const store = usePlayer();
  const dragging = useRef(false);
  const value = which === "start" ? range.start : range.end;
  const moved = (t: number) =>
    which === "start" ? moveStart(range, t, duration) : moveEnd(range, t, duration);
  const moveTo = (clientX: number): ClipRange | null => {
    const t = timeAt(clientX);
    if (t === null) return null;
    const next = moved(t);
    onChange(next);
    return next;
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const delta = keyDelta(e.key, e.shiftKey);
    const mine = delta !== null || e.key === "Escape" || e.key === " " || e.key === "Enter";
    if (!mine) return;
    // Captured: neither the timeline's thumb nor the player's shortcuts act on it too.
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") onChange(null);
    else if (delta !== null) onChange(moved(value + delta));
  };
  const end = (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const next = moveTo(e.clientX);
    // Let go, the picture shows the frame the handle is at.
    if (next !== null) void store.seek(which === "start" ? next.start : next.end);
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={which === "start" ? "Clip start" : "Clip end"}
      aria-orientation="horizontal"
      aria-valuemin={which === "start" ? 0 : range.start + CLIP_MIN_SECONDS}
      aria-valuemax={which === "start" ? range.end - CLIP_MIN_SECONDS : duration}
      aria-valuenow={value}
      aria-valuetext={formatDuration(value)}
      className="uro-clip-handle"
      data-handle={which}
      style={{ left: `${String(percent(value, duration))}%` }}
      onPointerDown={(e) => {
        // The timeline's own press would seek there and drag its thumb.
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus({ preventScroll: true });
        dragging.current = true;
      }}
      onPointerMove={(e) => {
        if (dragging.current) moveTo(e.clientX);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={(e) => {
        e.stopPropagation();
        dragging.current = false;
      }}
      onClick={stop}
      onKeyDownCapture={onKey}
    />
  );
}

/** The clip's range on the timeline: its band, and with `onChange` its two handles. */
function ClipLayer({
  range,
  onChange,
}: {
  range: ClipRange;
  onChange?: ((range: ClipRange | null) => void) | undefined;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const duration = useDuration() ?? range.end;
  const timeAt = (clientX: number): number | null => {
    const box = layer.current?.getBoundingClientRect();
    if (box === undefined || box.width <= 0) return null;
    return ((clientX - box.left) / box.width) * duration;
  };
  const from = percent(range.start, duration);
  const to = percent(range.end, duration);
  return (
    <div ref={layer} className="uro-clip-layer">
      <div
        className="uro-clip-band"
        data-readonly={onChange === undefined ? "" : undefined}
        style={{ left: `${String(from)}%`, width: `${String(to - from)}%` }}
      />
      {onChange === undefined
        ? null
        : (["start", "end"] as const).map((which) => (
            <Handle
              key={which}
              which={which}
              range={range}
              duration={duration}
              timeAt={timeAt}
              onChange={onChange}
            />
          ))}
    </div>
  );
}

/** The skin's time slider slot, filled: the picked clip with its handles, or `range` alone to show. */
export function ClipSlots({
  clip,
  range,
  children,
}: {
  clip: ClipControl | undefined;
  range: ClipRange | null;
  children: ReactNode;
}) {
  const picked = clip?.value ?? null;
  const shown = picked ?? range;
  const layer =
    shown === null ? null : (
      <ClipLayer range={shown} onChange={picked === null ? undefined : clip?.onChange} />
    );
  return <TimeSliderSlot.Provider value={layer}>{children}</TimeSliderSlot.Provider>;
}

/** Over the picture while a clip is picked: its range and length, coming and going with the controls. */
function ClipLabel({ range }: { range: ClipRange }) {
  return (
    <p className="uro-clip-label pointer-events-none absolute top-3 left-3 z-10 rounded-full bg-overlay px-3 py-1 text-xs text-overlay-foreground tabular-nums">
      Clip {clipLabel(range)} · {formatDuration(range.end - range.start)}
    </p>
  );
}

/**
 * Inside the skin: the picked clip's label over the picture, and playback pausing at the end of the
 * clip picked or the range shown.
 */
export function ClipOverlay({
  video,
  clip,
  range,
}: {
  video: Video;
  clip: ClipControl | undefined;
  range: ClipRange | null;
}) {
  const picked = clip?.value ?? null;
  const shown = picked ?? range;
  return (
    <>
      {shown === null ? null : <PauseAtEnd video={video} end={shown.end} />}
      {picked === null ? null : <ClipLabel range={picked} />}
    </>
  );
}
