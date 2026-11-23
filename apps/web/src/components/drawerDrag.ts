/**
 * The navigation drawer's drag, with no DOM attached (ported from Djinn, which took it from
 * Quire): where the finger is, which way it has decided to go, how fast it was moving when it
 * lifted, and which side the panel settles on. The panel follows the finger one to one, so this is
 * asked on every move; keeping it to pure functions over samples lets `useDrawerDrag` stay a thin
 * layer of listeners and pins the thresholds without a touch event in sight.
 *
 * Deliberately not an edge swipe: Android's gesture navigation and iOS take a swipe that begins on
 * the bezel as Back before the page hears of it. The drag begins anywhere instead, and the axis
 * judgement below keeps it from firing by accident. The distances are device pixels on purpose:
 * they measure a finger, not the UI, so they don't follow the UI's scale.
 */

/** A touch position and the event's timestamp, in ms. */
export interface Sample {
  x: number;
  y: number;
  t: number;
}

export type Side = "closed" | "open";

/**
 * What the drag has decided it is: `pending` until the finger has moved far enough to tell; `none`
 * for a scroll, or a push on a drawer already shut, and from then on the touch is not the drawer's.
 */
export type Axis = "pending" | "horizontal" | "none";

export interface Drag {
  readonly from: Side;
  readonly start: Sample;
  /** The recent moves, oldest first, trimmed to the velocity window. */
  readonly samples: readonly Sample[];
  readonly axis: Axis;
}

/** How far, in device pixels, the finger moves before its direction is judged. */
export const SLOP = 8;
/** The speed, in device pixels per ms, at which a release is a throw rather than a rest. */
export const FLICK = 0.4;
/** How far back, in ms, a release looks to read its speed. */
export const WINDOW = 100;
/** How long, in ms, a finger may sit still before lifting and still be throwing. */
export const REST = 100;

export function begin(from: Side, sample: Sample): Drag {
  return { from, start: sample, samples: [sample], axis: "pending" };
}

/**
 * The next sample. Judges the axis while it is pending: clearly more down than across is a scroll
 * and ends the matter; across twice as far as down locks; anything between waits for the next
 * move. Pushing a closed drawer further shut is nothing. A sample older than the last is refused
 * (devtools' touch emulation was seen to deliver one out of order).
 */
export function move(drag: Drag, sample: Sample): Drag {
  if (drag.axis === "none") return drag;
  const last = drag.samples.at(-1);
  if (last && sample.t < last.t) return drag;
  const since = sample.t - WINDOW;
  const samples = [...drag.samples.filter((s) => s.t >= since), sample];
  if (drag.axis === "horizontal") return { ...drag, samples };

  const dx = sample.x - drag.start.x;
  const dy = Math.abs(sample.y - drag.start.y);
  let axis: Axis = "pending";
  if (dy >= SLOP && dy >= Math.abs(dx)) axis = "none";
  else if (drag.from === "closed" && dx <= -SLOP) axis = "none";
  else if (Math.abs(dx) >= SLOP && dy * 2 < Math.abs(dx)) axis = "horizontal";
  return { ...drag, samples, axis };
}

/** How far the finger has travelled sideways since it landed. */
export function offset(drag: Drag): number {
  const last = drag.samples.at(-1);
  return last ? last.x - drag.start.x : 0;
}

/**
 * The finger's speed at release, in device pixels per ms, over the recent moves rather than the
 * last two samples (the lift repeats the last position). A finger that rested before lifting was
 * not throwing.
 */
export function velocity(drag: Drag, released: number): number {
  const first = drag.samples[0];
  const last = drag.samples.at(-1);
  if (!first || !last || first === last) return 0;
  if (released - last.t > REST) return 0;
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.x - first.x) / elapsed : 0;
}

/** How much of the panel is showing, 0 to 1, for a finger `dx` from where it landed. */
export function progress(from: Side, dx: number, width: number): number {
  if (width <= 0) return from === "closed" ? 0 : 1;
  const raw = from === "closed" ? dx / width : 1 + dx / width;
  return Math.min(1, Math.max(0, raw));
}

/**
 * Which side the panel settles on when the finger lifts: a throw by its direction, otherwise the
 * nearer side, exactly half counted as open.
 */
export function settle(showing: number, speed: number): Side {
  if (Math.abs(speed) >= FLICK) return speed > 0 ? "open" : "closed";
  return showing >= 0.5 ? "open" : "closed";
}
