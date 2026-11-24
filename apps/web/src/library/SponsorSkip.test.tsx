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
  const playTo = (t: number) => {
    video.currentTime = t;
    fireEvent(video, new Event("timeupdate"));
  };
  return { video, playTo };
}

describe("SponsorSkip", () => {
  it("jumps over a segment as playback reaches it, and Undo plays that one through", async () => {
    const { video, playTo } = renderPlayer();
    playTo(48);
    expect(video.currentTime).toBe(48);
    playTo(49.1);
    expect(video.currentTime).toBe(69);
    expect(await screen.findByText("Skipped sponsor")).toBeInTheDocument();
    // A plain click: jsdom has no pointer capture for the toast's swipe handling.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(video.currentTime).toBe(49.04);
    playTo(50);
    expect(video.currentTime).toBe(50);
  });

  it("jumps over overlapping segments at once, naming each", async () => {
    const { video, playTo } = renderPlayer();
    playTo(80);
    expect(video.currentTime).toBe(88.45);
    expect(await screen.findByText("Skipped self-promotion and sponsor")).toBeInTheDocument();
  });

  it("goes to the end for a segment that runs to it, and skips nothing while paused", () => {
    const { video, playTo } = renderPlayer();
    paused = true;
    playTo(60);
    expect(video.currentTime).toBe(60);
    paused = false;
    playTo(995);
    expect(video.currentTime).toBe(1008);
  });
});
