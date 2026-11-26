import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "@/lib/utils";

import { PreviewPlayer } from "./PreviewPlayer";

/**
 * A tile's hover preview (docs/library.md "Hover previews"): the whole video at 480p, played over
 * the thumbnail while a mouse rests on it, or after a press and hold on a touch screen, with a
 * scrub bar and sound and captions buttons (`PreviewPlayer.tsx`). It is never the player, so it
 * reports no watch progress and leaves the remembered volume and subtitles alone.
 */

/** A mouse resting this long starts it, so sweeping across a grid starts nothing. */
export const HOVER_DELAY_MS = 300;
/**
 * A press held this long starts it: well under the half second phones open their link menus at,
 * and longer than a tap.
 */
export const HOLD_MS = 200;
/** A finger moving further than this is scrolling, not holding. */
const MOVE_TOLERANCE_PX = 10;

// One preview plays at a time: starting one stops any other.
let playingNow: symbol | null = null;
const listeners = new Set<() => void>();
function setPlaying(next: symbol | null): void {
  if (playingNow === next) return;
  playingNow = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function release(id: symbol): void {
  if (playingNow === id) setPlaying(null);
}

interface PreviewGesture {
  /** Whether this tile's preview is playing. */
  playing: boolean;
  /** Ends it (the video played to its end). */
  stop: () => void;
  /** For the thumbnail's element; none when the video has no preview. */
  handlers: {
    onPointerEnter?: (e: PointerEvent) => void;
    onPointerLeave?: (e: PointerEvent) => void;
    onPointerDown?: (e: PointerEvent) => void;
    onPointerMove?: (e: PointerEvent) => void;
    onPointerUp?: (e: PointerEvent) => void;
    onPointerCancel?: () => void;
    onContextMenu?: (e: MouseEvent) => void;
    onClickCapture?: (e: MouseEvent) => void;
  };
}

/**
 * When a thumbnail (`surface`) plays its preview: a mouse resting on it, or a press and hold. It
 * stops when the mouse leaves, another starts, the thumbnail scrolls out of view, or a touch lands
 * outside it.
 */
function usePreviewGesture(
  enabled: boolean,
  surface: RefObject<HTMLDivElement | null>,
): PreviewGesture {
  const [id] = useState(() => Symbol("preview"));
  const playing = useSyncExternalStore(
    subscribe,
    () => playingNow === id,
    () => false,
  );
  const timer = useRef<number | undefined>(undefined);
  const press = useRef<{ x: number; y: number } | null>(null);
  // A hold started it: the click and the menu that follow the finger lifting are swallowed.
  const held = useRef(false);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      release(id);
    },
    [id],
  );

  useEffect(() => {
    if (!playing) return;
    const el = surface.current;
    if (el === null) return;
    const outside = (e: globalThis.PointerEvent) => {
      if (!(e.target instanceof Node) || !el.contains(e.target)) release(id);
    };
    document.addEventListener("pointerdown", outside, true);
    const seen =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            ([entry]) => {
              if (entry !== undefined && entry.intersectionRatio < 0.5) release(id);
            },
            { threshold: [0, 0.5] },
          );
    seen?.observe(el);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      seen?.disconnect();
    };
  }, [playing, id, surface]);

  const stop = () => {
    release(id);
  };
  if (!enabled) return { playing: false, stop, handlers: {} };

  const wait = (ms: number, then: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(then, ms);
  };
  const cancelPress = () => {
    window.clearTimeout(timer.current);
    press.current = null;
  };
  return {
    playing,
    stop,
    handlers: {
      onPointerEnter(e) {
        if (e.pointerType === "mouse") {
          wait(HOVER_DELAY_MS, () => {
            setPlaying(id);
          });
        }
      },
      onPointerLeave(e) {
        if (e.pointerType !== "mouse") return;
        window.clearTimeout(timer.current);
        release(id);
      },
      onPointerDown(e) {
        if (e.pointerType === "mouse") return;
        held.current = false;
        press.current = { x: e.clientX, y: e.clientY };
        wait(HOLD_MS, () => {
          press.current = null;
          held.current = true;
          setPlaying(id);
        });
      },
      onPointerMove(e) {
        const from = press.current;
        if (e.pointerType === "mouse" || from === null) return;
        if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > MOVE_TOLERANCE_PX) cancelPress();
      },
      onPointerUp(e) {
        if (e.pointerType !== "mouse") cancelPress();
      },
      onPointerCancel: cancelPress,
      onContextMenu(e) {
        // A phone's long-press menu, never a mouse's right-click.
        if (held.current || press.current !== null) e.preventDefault();
      },
      onClickCapture(e) {
        if (!held.current) return;
        held.current = false;
        e.preventDefault();
      },
    },
  };
}

/**
 * A thumbnail's box that plays the video's preview (none when `entryId` is null: no preview here,
 * or no picture to preview). The preview goes first, so the box's positioned children (the
 * duration badge) stay above the picture, and its controls above them. While it plays the box
 * carries `data-previewing`, which hides the watched bar under the scrub bar.
 */
export function PreviewSurface({
  entryId,
  className,
  children,
}: {
  entryId: string | null;
  className?: string;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const { playing, stop, handlers } = usePreviewGesture(entryId !== null, surface);
  return (
    <div
      ref={surface}
      {...handlers}
      data-previewing={playing ? "" : undefined}
      className={cn(
        // A press and hold is the preview's, not the phone's link menu or a text selection.
        entryId !== null &&
          "select-none [-webkit-touch-callout:none] [&_img]:[-webkit-user-drag:none]",
        className,
      )}
    >
      {entryId !== null && playing ? <PreviewPlayer entryId={entryId} onEnded={stop} /> : null}
      {children}
    </div>
  );
}
