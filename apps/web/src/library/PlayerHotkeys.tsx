import { Hotkey, useHotkey } from "@videojs/react";
import { usePlayer } from "@videojs/react/video";
import { type RefObject, useEffect, useRef, useState } from "react";

/** How far the arrow keys seek. `j`/`l` keep the skin's 10 s. */
export const ARROW_SEEK_SECONDS = 5;
/** One frame until the video has shown two consecutive ones to measure. */
export const DEFAULT_FRAME_SECONDS = 1 / 30;

/**
 * The skin's own shortcuts (its PlaybackHotkeys and VideoHotkeys, in @videojs/react's
 * internal/skins/shared), less the arrows, which are ours: copied here so they also work page-wide.
 * The step and direction come from the key, as in the skin.
 */
const SKIN_SHORTCUTS = [
  { keys: "Space", action: "togglePaused" },
  { keys: "k", action: "togglePaused" },
  { keys: "m", action: "toggleMuted" },
  { keys: "f", action: "toggleFullscreen" },
  { keys: "c", action: "toggleSubtitles" },
  { keys: "i", action: "togglePictureInPicture" },
  { keys: "l", action: "seekStep" },
  { keys: "j", action: "seekStep" },
  { keys: "ArrowUp", action: "volumeStep" },
  { keys: "ArrowDown", action: "volumeStep" },
  { keys: "0-9", action: "seekToPercent" },
  { keys: "Home", action: "seekToPercent", value: 0 },
  { keys: "End", action: "seekToPercent", value: 100 },
  { keys: ">", action: "speedUp" },
  { keys: "<", action: "speedDown" },
] as const;

/** Where the page's keys belong to something else: a dialog, the nav drawer, a menu, a list. */
const OVERLAY = '[role="dialog"], [role="alertdialog"], dialog, [role="menu"], [role="listbox"]';

/**
 * Whether the focus is somewhere the page-wide shortcuts must leave alone: inside an overlay (where
 * a letter is the menu's typeahead and Space a dialog's). Rechecked as the focus moves; on a blur
 * after the change, since a dialog that unmounts can drop the focus to the body without a focusin.
 */
function useFocusInOverlay(): boolean {
  const [inside, setInside] = useState(false);
  useEffect(() => {
    const check = () => {
      setInside(document.activeElement?.closest(OVERLAY) != null);
    };
    const later = () => {
      window.setTimeout(check, 0);
    };
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return inside;
}

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
 * 10 s, `m`, `f`, `c`, `i`, `0`-`9`, Home/End, `<`/`>`):
 *
 * - the arrows seek 5 s. The skin binds them to 10 s too, but the hotkey coordinator runs only the
 *   first matching binding, in registration order, and these register first: they render as the
 *   skin's children, ahead of its own hotkeys. `Player.test.tsx` pins that.
 * - `,` and `.` pause and step one frame back or forward.
 * - all of them work page-wide, as on YouTube's watch page, so a click on the description or a
 *   suggestion doesn't take them away: each also binds with `target: "document"`. The player's
 *   own binding handles a key pressed inside it first and marks it handled, which the
 *   document's then skips, so nothing fires twice. Typing in a field and Space or Enter on a
 *   button or link stay theirs (the coordinator skips those), and while the focus is in a dialog,
 *   the nav drawer or a menu the page-wide copies are off.
 *
 * Renders nothing; it must sit inside the skin, whose container the hotkeys listen on.
 */
export function PlayerHotkeys({ video }: { video: RefObject<HTMLVideoElement | null> }) {
  const store = usePlayer();
  const frame = useFrameLength(video);
  const overlay = useFocusInOverlay();
  const seekBy = (delta: number) => {
    const { currentTime, duration } = store.state;
    const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
    void store.seek(Math.min(Math.max(0, currentTime + delta), end));
  };
  const stepFrame = (direction: 1 | -1) => {
    store.pause();
    seekBy(direction * frame.current);
  };
  const ours = [
    { keys: "ArrowRight", action: "seekStep", value: ARROW_SEEK_SECONDS },
    { keys: "ArrowLeft", action: "seekStep", value: -ARROW_SEEK_SECONDS },
    { keys: ",", action: "frameStep", value: -1 },
    { keys: ".", action: "frameStep", value: 1 },
  ] as const;
  const run = (keys: (typeof ours)[number]["keys"]) => {
    if (keys === "ArrowRight") seekBy(ARROW_SEEK_SECONDS);
    else if (keys === "ArrowLeft") seekBy(-ARROW_SEEK_SECONDS);
    else stepFrame(keys === "." ? 1 : -1);
  };
  return (
    <>
      {(["player", "document"] as const).flatMap((target) =>
        ours.map((shortcut) => (
          <Shortcut
            key={`${target}:${shortcut.keys}`}
            {...shortcut}
            target={target}
            disabled={target === "document" && overlay}
            run={() => {
              run(shortcut.keys);
            }}
          />
        )),
      )}
      {SKIN_SHORTCUTS.map((shortcut) => (
        <Hotkey key={shortcut.keys} {...shortcut} target="document" disabled={overlay} />
      ))}
    </>
  );
}

/** One of our own shortcuts, bound on `target`: a component, so a list of them can render. */
function Shortcut({
  keys,
  action,
  value,
  target,
  disabled,
  run,
}: {
  keys: string;
  action: "seekStep" | "frameStep";
  value: number;
  target: "player" | "document";
  disabled: boolean;
  run: () => void;
}) {
  useHotkey({ keys, action, value, target, disabled, onActivate: run });
  return null;
}
