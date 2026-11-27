import type { ClipRange } from "@uroboros/contract";

import { formatDuration } from "@/downloads/format";

/**
 * Clips (docs/sharing.md#clips): a range of a video picked in the player, saved as its own cut file
 * or shared. The arithmetic and words of a range.
 */

/** A range in words, as the player shows times: `1:02–1:30`. */
export const clipLabel = (r: ClipRange): string =>
  `${formatDuration(r.start)}–${formatDuration(r.end)}`;
