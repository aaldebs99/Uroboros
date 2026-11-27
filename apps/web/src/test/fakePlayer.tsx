import type { ReactElement, ReactNode } from "react";

/**
 * The watch page's player in tests, as `vi.mock("./Player", () => import("@/test/fakePlayer"))`:
 * jsdom plays nothing and has no Video.js menus to open, so it shows what the page gave it as
 * attributes, offers the settings menu's Quality choices and Stats row as buttons, shows the
 * overlay, and has buttons for a moment played and for a failure to play.
 */

/** The settings slot's content (PlayerSettings), read for its Quality choices and Stats row. */
type Settings = ReactElement<{
  quality: { options: { value: string; label: string }[]; onChange: (v: string) => void } | null;
  onStats: () => void;
}>;

export function Player(props: {
  src: string;
  hls?: { native: boolean };
  start: number;
  seek: { time: number; pause?: boolean } | null;
  subtitles: { lang: string }[];
  settings?: Settings;
  overlay?: ReactNode;
  onTime: (at: number, duration: number) => void;
  onError?: () => void;
  /** The page's clip control (the Clip button), and a range only to show. */
  clip?: { value: { start: number; end: number } | null } | undefined;
  range?: { start: number; end: number } | null;
}) {
  return (
    <div
      data-testid="player"
      data-src={props.src}
      data-hls={props.hls === undefined ? "" : props.hls.native ? "native" : "mse"}
      data-start={String(props.start)}
      data-seek={props.seek === null ? "" : String(props.seek.time)}
      data-seek-pause={props.seek?.pause === true ? "true" : ""}
      data-subs={props.subtitles.map((s) => s.lang).join(",")}
      data-clip={props.clip === undefined ? "" : "on"}
      data-clip-range={
        props.clip?.value == null
          ? ""
          : `${String(props.clip.value.start)}-${String(props.clip.value.end)}`
      }
      data-range={
        props.range == null ? "" : `${String(props.range.start)}-${String(props.range.end)}`
      }
    >
      {props.settings?.props.quality?.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.settings?.props.quality?.onChange(o.value)}
        >
          quality {o.label}
        </button>
      ))}
      <button type="button" onClick={() => props.settings?.props.onStats()}>
        stats
      </button>
      {props.overlay}
      <button
        type="button"
        onClick={() => {
          props.onTime(30, 596);
        }}
      >
        play to 0:30
      </button>
      <button type="button" onClick={() => props.onError?.()}>
        fail to play
      </button>
    </div>
  );
}
