import { type RefObject, useEffect, useRef } from "react";
import { flushSync } from "react-dom";

import {
  type Drag,
  type Side,
  begin,
  move,
  offset,
  progress,
  settle,
  velocity,
} from "./drawerDrag";

/**
 * What the drawer is doing. `closed` renders nothing; `dragging` renders the dialog without
 * opening it, positioned by inline styles a finger writes; `settling` is that box sliding back
 * after a drag let go early; `open` is modal; `closing` is modal and sliding out after a drag.
 * Modality arrives at release, not during the drag, so no engine is asked to keep delivering a
 * touch to a page `showModal()` has just made inert.
 */
export type Phase = "closed" | "dragging" | "settling" | "open" | "closing";

export type DrawerParts = {
  dialog: RefObject<HTMLDialogElement | null>;
  panel: RefObject<HTMLDivElement | null>;
  scrim: RefObject<HTMLDivElement | null>;
};

/** Hands the panel back to the stylesheet, which eases it to its place. */
export function release({ dialog, panel, scrim }: DrawerParts) {
  dialog.current?.removeAttribute("data-dragging");
  panel.current?.style.removeProperty("translate");
  scrim.current?.style.removeProperty("opacity");
}

/** Sends the panel out of sight, easing from wherever it is. */
export function hide({ dialog, panel, scrim }: DrawerParts, width: number) {
  dialog.current?.removeAttribute("data-dragging");
  panel.current?.style.setProperty("translate", `${String(-width)}px 0`);
  scrim.current?.style.setProperty("opacity", "0");
}

/**
 * Whether a touch began on something that already has a use for a sideways drag: a box that
 * scrolls sideways (the filter chips, the library's tabs), a field that selects with it, a slider
 * (the player's timeline and volume), or anything marked `data-own-swipe` (the player).
 */
function spokenFor(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (el?.closest('input, textarea, select, [role="slider"], [data-own-swipe]')) return true;
  for (let box = el; box; box = box.parentElement) {
    const overflow = getComputedStyle(box).overflowX;
    if ((overflow === "auto" || overflow === "scroll") && box.scrollWidth > box.clientWidth) {
      return true;
    }
  }
  return false;
}

type Touching = {
  from: Side;
  parts: DrawerParts;
  setPhase: (phase: Phase) => void;
  drag: RefObject<Drag | null>;
  /** The panel's width, measured when a drag locks. */
  width: RefObject<number>;
};

/**
 * The first move that locks sideways: the panel must exist and be laid out before it can follow,
 * so `dragging` renders synchronously. False when there is nothing to follow.
 */
function lock({ from, parts, setPhase, width }: Touching): boolean {
  if (from === "closed") {
    flushSync(() => {
      setPhase("dragging");
    });
  } else {
    parts.dialog.current?.setAttribute("data-dragging", "");
  }
  const measured = parts.panel.current?.offsetWidth ?? 0;
  if (!(measured > 0)) {
    if (from === "closed") setPhase("closed");
    return false;
  }
  width.current = measured;
  return true;
}

/** The panel's edge where the finger has put it, clamped to the panel, and the scrim with it. */
function follow({ from, parts, width }: Touching, next: Drag) {
  const dx = offset(next);
  const shift = Math.max(-width.current, Math.min(0, from === "closed" ? dx - width.current : dx));
  parts.panel.current?.style.setProperty("translate", `${String(shift)}px 0`);
  parts.scrim.current?.style.setProperty("opacity", String(progress(from, dx, width.current)));
}

/** Where the panel goes when the finger lifts (`released`) or the browser takes the touch. */
function land({ from, parts, setPhase, width }: Touching, current: Drag, released?: number) {
  const side =
    released === undefined
      ? "closed"
      : settle(progress(from, offset(current), width.current), velocity(current, released));
  if (from === "closed") setPhase(side === "open" ? "open" : "settling");
  else if (side === "closed" && released !== undefined) setPhase("closing");
  else release(parts);
}

/**
 * The drawer's touch pipeline: passive listeners on the document,
 * reinstalled per phase, the gesture itself in a ref that outlives them. A drag may start anywhere
 * but where a sideways drag already means something; the open panel is dragged shut the same way.
 * With `enabled` false (from `md` up) there are no listeners and only the button opens it.
 */
export function useDrawerDrag(
  enabled: boolean,
  phase: Phase,
  setPhase: (phase: Phase) => void,
  parts: DrawerParts,
  width: RefObject<number>,
) {
  const drag = useRef<Drag | null>(null);
  /** The touch that owns the gesture; others are ignored. */
  const finger = useRef(0);

  useEffect(() => {
    if (phase !== "dragging") drag.current = null;
    if (!enabled || phase === "closing") return;
    const touching: Touching = {
      from: phase === "open" ? "open" : "closed",
      parts,
      setPhase,
      drag,
      width,
    };
    const sample = (touch: Touch, event: TouchEvent) => ({
      x: touch.clientX,
      y: touch.clientY,
      t: event.timeStamp,
    });
    const owned = (list: TouchList) =>
      Array.from(list).find((touch) => touch.identifier === finger.current);

    const onStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (drag.current || !touch) return;
      if (touching.from === "closed" && spokenFor(event.target)) return;
      finger.current = touch.identifier;
      drag.current = begin(touching.from, sample(touch, event));
    };
    const onMove = (event: TouchEvent) => {
      const current = drag.current;
      const touch = owned(event.changedTouches);
      if (!current || !touch) return;
      const next = move(current, sample(touch, event));
      drag.current = next.axis === "none" ? null : next;
      if (next.axis !== "horizontal") return;
      if (current.axis !== "horizontal" && !lock(touching)) {
        drag.current = null;
        return;
      }
      follow(touching, next);
    };
    const onEnd = (event: TouchEvent, released?: number) => {
      const current = drag.current;
      if (!current || !owned(event.changedTouches)) return;
      drag.current = null;
      if (current.axis === "horizontal") land(touching, current, released);
    };
    const onLift = (event: TouchEvent) => {
      onEnd(event, event.timeStamp);
    };
    const onCancel = (event: TouchEvent) => {
      onEnd(event);
    };

    const options = { passive: true } as const;
    document.addEventListener("touchstart", onStart, options);
    document.addEventListener("touchmove", onMove, options);
    document.addEventListener("touchend", onLift, options);
    document.addEventListener("touchcancel", onCancel, options);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onLift);
      document.removeEventListener("touchcancel", onCancel);
    };
  }, [enabled, phase, setPhase, parts, width]);
}
