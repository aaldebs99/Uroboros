import { fireEvent, render, screen } from "@testing-library/react";
import type { SponsorSegment } from "@uroboros/contract";
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

const DEFAULT_SEGMENTS: SponsorSegment[] = [
  { start: 77.694, end: 88.43, category: "selfpromo", show: true, skip: true },
  { start: 49.04, end: 69, category: "sponsor", show: true, skip: true },
  { start: 77.75, end: 88.45, category: "sponsor", show: true, skip: true },
  { start: 990, end: 1008, category: "sponsor", show: true, skip: true },
];

function renderPlayer(segments: SponsorSegment[] = DEFAULT_SEGMENTS) {
  const { container } = render(
    <>
      <Player
        src="/v"
        title="t"
        start={0}
        autoPlay={false}
        seek={null}
        chapters={[]}
        sponsorSegments={segments}
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
  it("jumps over a segment playback runs into without a toast, and a seek back watches it", async () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(48);
    playTo(48.5);
    expect(video.currentTime).toBe(48.5);
    playTo(49.1);
    expect(video.currentTime).toBe(69);
    // Long enough for a toast to have rendered.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.querySelector("[data-sonner-toast]")).toBeNull();
    expect(screen.queryByText(/Skipped/)).toBeNull();
    // Seeking back to its start plays the segment through.
    seekTo(49.04);
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

  it("jumps over overlapping segments at once", () => {
    const { video, playTo, seekTo } = renderPlayer();
    seekTo(77.5);
    playTo(77.8);
    expect(video.currentTime).toBe(88.45);
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

  it("does not jump over a segment that is shown but not skipped", () => {
    const { video, playTo, seekTo } = renderPlayer([
      { start: 49.04, end: 69, category: "intro", show: true, skip: false },
    ]);
    seekTo(48.5);
    playTo(49.2);
    expect(video.currentTime).toBe(49.2);
  });

  it("jumps over a segment that is skipped but not shown", () => {
    const { video, playTo, seekTo } = renderPlayer([
      { start: 49.04, end: 69, category: "filler", show: false, skip: true },
    ]);
    seekTo(48.5);
    playTo(49.2);
    expect(video.currentTime).toBe(69);
  });
});
