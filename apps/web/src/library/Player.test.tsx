import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
