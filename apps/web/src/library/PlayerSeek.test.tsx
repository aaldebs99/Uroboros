import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { Player, type PlayerProps } from "./Player";

const noop = () => undefined;

/**
 * The page's seek requests (a chapter, a transcript line, Mark as unwatched): playback goes to the
 * time and plays from there, or with `pause` stops there.
 */
describe("Player seek", () => {
  let play: MockInstance<HTMLMediaElement["play"]>;
  let pause: MockInstance<HTMLMediaElement["pause"]>;
  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(noop);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderAt(seek: PlayerProps["seek"]) {
    const props: PlayerProps = {
      src: "/v",
      title: "t",
      start: 0,
      autoPlay: false,
      seek: null,
      chapters: [],
      subtitles: [],
      onTime: noop,
      onPause: noop,
      onEnded: noop,
    };
    const { container, rerender } = render(<Player {...props} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    video.currentTime = 300;
    play.mockClear();
    rerender(<Player {...props} seek={seek} />);
    return video;
  }

  it("plays from where a seek goes", async () => {
    const video = renderAt({ time: 60 });
    expect(video.currentTime).toBe(60);
    await vi.waitFor(() => {
      expect(play).toHaveBeenCalled();
    });
    expect(pause).not.toHaveBeenCalled();
  });

  it("stops where a seek that asks to pause goes", async () => {
    const video = renderAt({ time: 0, pause: true });
    expect(video.currentTime).toBe(0);
    expect(pause).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(play).not.toHaveBeenCalled();
  });
});
