import { type RefObject, useEffect } from "react";

/**
 * Pauses playback once as it reaches `end` (a clip's: the one picked, or the range a link opens the
 * whole video at; docs/sharing.md#clips). Playing on from there goes on; a seek back before `end`
 * pauses there again. Renders nothing.
 */
export function PauseAtEnd({
  video,
  end,
}: {
  video: RefObject<HTMLVideoElement | null>;
  end: number;
}) {
  useEffect(() => {
    const v = video.current;
    if (v === null) return;
    let last = v.currentTime;
    let armed = last < end;
    const onTime = () => {
      const now = v.currentTime;
      if (armed && !v.paused && last < end && now >= end) {
        armed = false;
        v.pause();
      }
      last = now;
    };
    const onSeeked = () => {
      last = v.currentTime;
      if (last < end) armed = true;
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("seeked", onSeeked);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("seeked", onSeeked);
    };
  }, [video, end]);
  return null;
}
