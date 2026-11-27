import type { ClipRange } from "@uroboros/contract";
import { useState } from "react";

import { useInfo } from "@/api/client";

import type { ClipControl } from "./ClipControls";

/**
 * The clip picked in the watch page's player (docs/sharing.md#clips), for this video only, while
 * the server has clips on: the range, the player's control of it, and the range a link opened the
 * whole video at (`shown`; none while clips are off).
 */
export function usePickedClip(
  entryId: string,
  linked: ClipRange | null | undefined,
): {
  clip: ClipRange | null;
  control: ClipControl | undefined;
  shown: ClipRange | null;
} {
  const on = useInfo().data?.clips === true;
  const [picked, setPicked] = useState<{ id: string; range: ClipRange } | null>(null);
  const clip = on && picked?.id === entryId ? picked.range : null;
  const control: ClipControl | undefined = on
    ? {
        value: clip,
        onChange: (r) => {
          setPicked(r === null ? null : { id: entryId, range: r });
        },
      }
    : undefined;
  return { clip, control, shown: on ? (linked ?? null) : null };
}
