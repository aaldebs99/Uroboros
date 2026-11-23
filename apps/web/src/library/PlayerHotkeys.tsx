import { useHotkey } from "@videojs/react";
import { usePlayer } from "@videojs/react/video";
import { type RefObject, useEffect, useRef } from "react";

/** How far the arrow keys seek. `j`/`l` keep the skin's 10 s. */
export const ARROW_SEEK_SECONDS = 5;
/** One frame until the video has shown two consecutive ones to measure. */
export const DEFAULT_FRAME_SECONDS = 1 / 30;

/**
 * The length of one frame, measured from consecutive presented frames
 * (`requestVideoFrameCallback`); `DEFAULT_FRAME_SECONDS` until then, or where the API is missing.
 */
function useFrameLength(video: RefObject<HTMLVideoElement | null>): RefObject<number> {
  const frame = useRef(DEFAULT_FRAME_SECONDS);
  useEffect(() => {
    const v = video.current;
    if (v === null || !("requestVideoFrameCallback" in v)) return;
    let last: { mediaTime: number; presentedFrames: number } | null = null;
    let shortest = Infinity;
    let handle = 0;
    const onFrame: VideoFrameRequestCallback = (_now, meta) => {
      // Only frames presented back to back measure one frame; a seek or a dropped frame doesn't.
      if (last !== null && meta.presentedFrames === last.presentedFrames + 1) {
        const delta = meta.mediaTime - last.mediaTime;
        if (delta > 1 / 240 && delta < shortest) {
          shortest = delta;
          frame.current = delta;
        }
      }
      last = { mediaTime: meta.mediaTime, presentedFrames: meta.presentedFrames };
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => {
      v.cancelVideoFrameCallback(handle);
    };
  }, [video]);
  return frame;
}

/**
 * The player's own shortcuts, on top of the skin's (Space and `k` play and pause, `j`/`l` seek
 * 10 s, `m`, `f`, `c`, `i`, `0`-`9`, `<`/`>`):
 *
 * - the arrows seek 5 s. The skin binds them to 10 s too, but the hotkey coordinator runs only the
 *   first matching binding, in registration order, and these register first: they render as the
 *   skin's children, ahead of its own hotkeys. `Player.test.tsx` pins that.
 * - `,` and `.` pause and step one frame back or forward.
 *
 * Renders nothing; it must sit inside the skin, whose container the hotkeys listen on.
 */
export function PlayerHotkeys({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const store = usePlayer();
  const frame = useFrameLength(video);
  const seekBy = (delta: number) => {
    const { currentTime, duration } = store.state;
    const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    void store.seek(Math.min(Math.max(0, currentTime + delta), end));
  };
  const stepFrame = (direction: 1 | -1) => {
    store.pause();
    seekBy(direction * frame.current);
  };
  useHotkey({
    keys: "ArrowRight",
    action: "seekStep",
    value: ARROW_SEEK_SECONDS,
    onActivate: () => {
      seekBy(ARROW_SEEK_SECONDS);
    },
  });
  useHotkey({
    keys: "ArrowLeft",
    action: "seekStep",
    value: -ARROW_SEEK_SECONDS,
    onActivate: () => {
      seekBy(-ARROW_SEEK_SECONDS);
    },
  });
  useHotkey({
    keys: ",",
    action: "frameStep",
    value: -1,
    onActivate: () => {
      stepFrame(-1);
    },
  });
  useHotkey({
    keys: ".",
    action: "frameStep",
    value: 1,
    onActivate: () => {
      stepFrame(1);
    },
  });
  return null;
}
