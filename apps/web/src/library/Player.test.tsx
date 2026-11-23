import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readVolume, storeVolume } from "@/lib/playerPrefs";

import { Player } from "./Player";

const noop = () => undefined;

describe("Player", () => {
  it("resumes at the saved position even when the metadata loaded before React listened", () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4,
    });
    try {
      const { container } = render(
        <Player
          src="/v"
          title="t"
          start={42}
          autoPlay={false}
          seek={null}
          chapters={[]}
          subtitles={[]}
          onTime={noop}
          onPause={noop}
          onEnded={noop}
        />,
      );
      expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(42);
    } finally {
      if (desc) Object.defineProperty(HTMLMediaElement.prototype, "readyState", desc);
    }
  });

  it("resumes once per video, not again when the saved position changes", () => {
    const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState");
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4,
    });
    try {
      const props = {
        src: "/v",
        title: "t",
        autoPlay: false,
        seek: null,
        chapters: [],
        subtitles: [],
        onTime: noop,
        onPause: noop,
        onEnded: noop,
      };
      const { container, rerender } = render(<Player {...props} start={42} />);
      const video = container.querySelector("video") as HTMLVideoElement;
      video.currentTime = 300;
      rerender(<Player {...props} start={290} />);
      expect(video.currentTime).toBe(300);
    } finally {
      if (desc) Object.defineProperty(HTMLMediaElement.prototype, "readyState", desc);
    }
  });

  it("wraps the video in Video.js controls, branded with the app's accent", () => {
    const { container } = render(
      <Player
        src="/v"
        title="t"
        start={0}
        autoPlay={false}
        seek={null}
        chapters={[]}
        subtitles={[]}
        onTime={noop}
        onPause={noop}
        onEnded={noop}
      />,
    );
    expect(screen.getAllByRole("button", { name: /play/i }).length).toBeGreaterThan(0);
    const skin = container.querySelector<HTMLElement>("[style*='--media-accent-color']");
    expect(skin?.style.getPropertyValue("--media-accent-color")).toBe("var(--primary)");
  });

  it("takes chapters for the timeline without trouble", () => {
    const chapters = [
      { start: 0, end: 15, title: "Intro" },
      { start: 15, end: null, title: null },
    ];
    expect(() =>
      render(
        <Player
          src="/v"
          title="t"
          start={0}
          autoPlay={false}
          seek={null}
          chapters={chapters}
          subtitles={[]}
          onTime={noop}
          onPause={noop}
          onEnded={noop}
        />,
      ),
    ).not.toThrow();
  });
});

/** Pretends the metadata is in, so the player starts at once. */
function withMetadata(): () => void {
  const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "readyState");
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
    configurable: true,
    get: () => 4,
  });
  return () => {
    if (desc) Object.defineProperty(HTMLMediaElement.prototype, "readyState", desc);
  };
}

const base = {
  src: "/v",
  title: "t",
  start: 0,
  seek: null,
  chapters: [],
  subtitles: [],
  onTime: noop,
  onPause: noop,
  onEnded: noop,
};

describe("Player autoplay and volume", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts playing once it has resumed, when asked to", async () => {
    const restore = withMetadata();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    try {
      const { container } = render(<Player {...base} start={42} autoPlay />);
      await vi.waitFor(() => {
        expect(play).toHaveBeenCalledTimes(1);
      });
      expect((container.querySelector("video") as HTMLVideoElement).currentTime).toBe(42);
    } finally {
      restore();
    }
  });

  it("waits for the play button when the browser refuses autoplay, and when not asked", async () => {
    const restore = withMetadata();
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    try {
      expect(() => render(<Player {...base} autoPlay />)).not.toThrow();
      await vi.waitFor(() => {
        expect(play).toHaveBeenCalledTimes(1);
      });
      render(<Player {...base} src="/w" autoPlay={false} />);
      await new Promise((r) => setTimeout(r, 20));
      expect(play).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("applies the remembered volume and remembers a change", () => {
    storeVolume({ volume: 0.3, muted: true });
    const { container } = render(<Player {...base} autoPlay={false} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.volume).toBe(0.3);
    expect(video.muted).toBe(true);
    video.volume = 0.8;
    video.muted = false;
    fireEvent(video, new Event("volumechange"));
    expect(readVolume()).toEqual({ volume: 0.8, muted: false });
  });
});
