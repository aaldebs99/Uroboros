import type { ClipRange, LibraryItem } from "@uroboros/contract";
import { useRef, useState } from "react";

import { useInfo } from "@/api/client";

import type { ClipControl } from "./ClipControls";
import { defaultRange } from "./clipRange";

/**
 * The clip picked on the watch page (docs/sharing.md#clips), for this video only, while the server
 * has clips on: the range; the player's control of it (its handles change it); the range a link
 * opened the whole video at (`shown`; none while clips are off); and the Clip button's toggle,
 * which picks 30 s from where playback is (`track` follows it) once the video's length is known.
 */
export function usePickedClip(
  entryId: string,
  linked: ClipRange | null | undefined,
  item: Pick<LibraryItem, "duration"> | undefined,
): {
  clip: ClipRange | null;
  control: ClipControl | undefined;
  shown: ClipRange | null;
  toggle: (() => void) | undefined;
  canClip: boolean;
  track: (at: number) => void;
} {
  const on = useInfo().data?.clips === true;
  const [picked, setPicked] = useState<{ id: string; range: ClipRange } | null>(null);
  const at = useRef(0);
  const clip = on && picked?.id === entryId ? picked.range : null;
  const pick = (r: ClipRange | null) => {
    setPicked(r === null ? null : { id: entryId, range: r });
  };
  const duration = item?.duration ?? null;
  const known = duration !== null && duration > 0;
  return {
    clip,
    control: on ? { value: clip, onChange: pick } : undefined,
    shown: on ? (linked ?? null) : null,
    toggle: on
      ? () => {
          if (clip !== null) pick(null);
          else if (known) pick(defaultRange(at.current, duration));
        }
      : undefined,
    canClip: known,
    track: (t) => {
      at.current = t;
    },
  };
}
