import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Toaster } from "@/components/ui/sonner";

import { Player } from "./Player";

const noop = () => undefined;

/** Overrides a media element getter on the prototype; returns its undo. */
function stub(name: "paused" | "seeking" | "duration", get: () => unknown): () => void {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name);
  Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, get });
  return () => {
    if (desc) Object.defineProperty(HTMLMediaElement.prototype, name, desc);
  };
}

let paused = false;
let restore: (() => void)[] = [];
beforeEach(() => {
  paused = false;
  restore = [
    stub("paused", () => paused),
    stub("seeking", () => false),
    stub("duration", () => 1008),
  ];
});
afterEach(() => {
  for (const r of restore) r();
});

function renderPlayer() {
  const { container } = render(
    <>
      <Player
        src="/v"
        title="t"
        start={0}
        autoPlay={false}
        seek={null}
        chapters={[]}
        skipSegments={[
          { start: 77.694, end: 88.43, category: "selfpromo" },
          { start: 49.04, end: 69, category: "sponsor" },
          { start: 77.75, end: 88.45, category: "sponsor" },
          { start: 990, end: 1008, category: "sponsor" },
        ]}
        subtitles={[]}
        onTime={noop}
        onPause={noop}
        onEnded={noop}
      />
      <Toaster />
    </>,
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
  return { video, playTo, seekTo };
}

describe("SponsorSkip", () => {
  it("jumps over a segment playback runs into, and Undo plays that one through", async () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(48);
    playTo(48.5);
    expect(video.currentTime).toBe(48.5);
    playTo(49.1);
    expect(video.currentTime).toBe(69);
    expect(await screen.findByText("Skipped sponsor")).toBeInTheDocument();
    // A plain click: jsdom has no pointer capture for the toast's swipe handling.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(video.currentTime).toBe(49.04);
    playTo(49.3);
    playTo(50);
    expect(video.currentTime).toBe(50);
  });

  it("lets a segment the viewer seeks into play out", () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(55);
    playTo(55.25);
    playTo(55.5);
    playTo(56.5);
    expect(video.currentTime).toBe(56.5);
  });

  it("skips a segment playback reaches after a seek to just before it", () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(55);
    playTo(55.25);
    seekTo(76.9);
    playTo(77.2);
    playTo(77.8);
    expect(video.currentTime).toBe(88.45);
  });

  it("jumps over overlapping segments at once, naming each", async () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(77.5);
    playTo(77.8);
    expect(video.currentTime).toBe(88.45);
    expect(await screen.findByText("Skipped self-promotion and sponsor")).toBeInTheDocument();
  });

  it("goes to the end for a segment that runs to it, and skips nothing while paused", () => {
    const { video, playTo, seekTo } = renderPlayer();
    paused = true;
    seekTo(48.5);
    playTo(49.2);
    expect(video.currentTime).toBe(49.2);
    paused = false;
    seekTo(989.5);
    playTo(990.2);
    expect(video.currentTime).toBe(1008);
  });
});
