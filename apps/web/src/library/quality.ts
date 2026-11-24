import type { PlaybackFacts } from "@uroboros/contract";

import type { QualityChoice } from "./QualityMenu";

/** The Quality menu's choices: Original, then the rungs the video offers (docs/transcoding.md). */
export function qualityChoices(qualities: PlaybackFacts["qualities"]): QualityChoice[] {
  return [
    { value: "original", label: "Original" },
    ...qualities.map((q) => ({ value: q, label: `${q}p` })),
  ];
}
