import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SPONSORBLOCK_COLORS, type SponsorBlockColors } from "@uroboros/contract";
import { describe, expect, it } from "vitest";

import { Player } from "./Player";

const noop = () => undefined;

function renderPlayer(highlight: number | null, colors?: SponsorBlockColors) {
  const { container } = render(
    <Player
      src="/v"
      title="t"
      start={0}
      autoPlay={false}
      seek={null}
      chapters={[]}
      sponsorSegments={[]}
      sponsorHighlight={highlight}
      sponsorColors={colors}
      subtitles={[]}
      onTime={noop}
      onPause={noop}
      onEnded={noop}
    />,
  );
  const video = container.querySelector("video") as HTMLVideoElement;
  /** Playback moving on to `t` (a `timeupdate`). */
  const playTo = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("timeupdate"));
  };
  /** The viewer seeking to `t` (jsdom fires no `seeked` itself). */
  const seekTo = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("seeked"));
  };
  return { container, video, playTo, seekTo };
}

const jump = () => screen.queryByRole("button", { name: "Jump to highlight" });

describe("Jump to highlight (docs/automation.md#sponsorblock)", () => {
  it("is offered short of the highlight, and a press goes there", () => {
    const { video, playTo } = renderPlayer(120);
    playTo(10);
    const button = jump();
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLElement);
    expect(video.currentTime).toBe(120);
    playTo(120.25);
    expect(jump()).toBeNull();
  });

  it("goes once playback is past the highlight, and comes back after a seek before it", () => {
    const { playTo, seekTo } = renderPlayer(120);
    playTo(119.5);
    expect(jump()).toBeNull();
    seekTo(30);
    expect(jump()).not.toBeNull();
  });

  it("isn't there for a video without a highlight", () => {
    const { playTo } = renderPlayer(null);
    playTo(5);
    expect(jump()).toBeNull();
  });
});

describe("the timeline's SponsorBlock colours", () => {
  const skin = (container: HTMLElement) => container.querySelector(".uro-player") as HTMLElement;

  it("are SponsorBlock's own until the person picks theirs", () => {
    const { container } = renderPlayer(null);
    expect(skin(container).style.getPropertyValue("--uro-sb-sponsor")).toBe("#00d400");
    expect(skin(container).style.getPropertyValue("--uro-sb-poi_highlight")).toBe("#ff1684");
  });

  it("are the person's own when they picked them", () => {
    const { container } = renderPlayer(null, {
      ...DEFAULT_SPONSORBLOCK_COLORS,
      sponsor: "#123456",
      hook: "#abcdef",
    });
    expect(skin(container).style.getPropertyValue("--uro-sb-sponsor")).toBe("#123456");
    expect(skin(container).style.getPropertyValue("--uro-sb-hook")).toBe("#abcdef");
    expect(skin(container).style.getPropertyValue("--uro-sb-intro")).toBe("#00ffff");
  });
});
