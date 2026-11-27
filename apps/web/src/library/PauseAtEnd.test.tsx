import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PauseAtEnd } from "./PauseAtEnd";

/** A clip's end (docs/sharing.md#clips): playback pauses once there, and again after a seek back. */

afterEach(() => {
  vi.restoreAllMocks();
});

function Harness({ end }: { end: number }) {
  const video = useRef<HTMLVideoElement>(null);
  return (
    <>
      <video ref={video} />
      <PauseAtEnd video={video} end={end} />
    </>
  );
}

function playing() {
  const { container } = render(<Harness end={90} />);
  const video = container.querySelector("video") as HTMLVideoElement;
  let paused = false;
  vi.spyOn(video, "paused", "get").mockImplementation(() => paused);
  const pause = vi.spyOn(video, "pause").mockImplementation(() => {
    paused = true;
  });
  const at = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("timeupdate"));
  };
  const play = () => {
    paused = false;
  };
  const seekTo = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("seeked"));
  };
  return { at, play, seekTo, pause };
}

describe("PauseAtEnd", () => {
  it("pauses once playback reaches the end, then lets it play on", () => {
    const { at, play, pause } = playing();
    at(80);
    at(89.8);
    expect(pause).not.toHaveBeenCalled();
    at(90.1);
    expect(pause).toHaveBeenCalledTimes(1);
    play();
    at(95);
    at(100);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("pauses there again after a seek back before the end", () => {
    const { at, play, seekTo, pause } = playing();
    at(89.9);
    at(90.2);
    play();
    seekTo(85);
    at(89.9);
    at(90.3);
    expect(pause).toHaveBeenCalledTimes(2);
  });
});
