import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
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
    // Named for screen readers, with no title to hang a tooltip over the picture.
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("aria-label", "t");
    expect(video).not.toHaveAttribute("title");
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

describe("Player keyboard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Renders the player at `at` seconds of a 100 s video, beside `page` (the rest of the watch page),
   * and a way to press a key on it.
   */
  async function playerAt(at: number, page: ReactNode = null, highlight: number | null = null) {
    const restore = withMetadata();
    const duration = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "duration");
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get: () => 100,
    });
    const { container } = render(
      <>
        <Player {...base} autoPlay={false} sponsorHighlight={highlight} />
        {page}
      </>,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    const skin = container.querySelector<HTMLElement>("[data-theme='neutral']");
    if (skin === null) throw new Error("no skin container");
    video.currentTime = at;
    fireEvent(video, new Event("durationchange"));
    fireEvent(video, new Event("timeupdate"));
    // The hotkeys register once the container has attached.
    await new Promise((r) => setTimeout(r, 0));
    /** A key pressed on `on`: the player unless said otherwise. */
    const press = (key: string, on: Element = skin) => {
      fireEvent.keyDown(on, { key });
      fireEvent(video, new Event("timeupdate"));
    };
    const cleanup = () => {
      restore();
      if (duration) Object.defineProperty(HTMLMediaElement.prototype, "duration", duration);
    };
    /** The viewer seeking back to `t` (jsdom fires no `seeked` itself). */
    const seekTo = (t: number) => {
      video.currentTime = t;
      fireEvent(video, new Event("seeked"));
    };
    return { video, skin, press, seekTo, cleanup };
  }

  it("seeks 5 s with the arrows, overriding the skin's 10 s", async () => {
    const { video, press, cleanup } = await playerAt(50);
    try {
      press("ArrowRight");
      expect(video.currentTime).toBe(55);
      press("ArrowLeft");
      press("ArrowLeft");
      expect(video.currentTime).toBe(45);
    } finally {
      cleanup();
    }
  });

  it("keeps the skin's 10 s on j and l", async () => {
    const { video, press, cleanup } = await playerAt(50);
    try {
      press("l");
      expect(video.currentTime).toBe(60);
      press("j");
      press("j");
      expect(video.currentTime).toBe(40);
    } finally {
      cleanup();
    }
  });

  it("pauses and steps one frame with , and .", async () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const { video, press, cleanup } = await playerAt(10);
    try {
      press(".");
      expect(pause).toHaveBeenCalled();
      expect(video.currentTime).toBeCloseTo(10 + 1 / 30, 5);
      press(",");
      press(",");
      expect(video.currentTime).toBeCloseTo(10 - 1 / 30, 5);
    } finally {
      cleanup();
    }
  });

  it("works page-wide: a key pressed with the focus elsewhere on the page reaches the player", async () => {
    const { video, press, cleanup } = await playerAt(50, <p>The description</p>);
    try {
      press("l", document.body);
      expect(video.currentTime).toBe(60);
      press("ArrowLeft", screen.getByText("The description"));
      expect(video.currentTime).toBe(55);
      press(".", document.body);
      expect(video.currentTime).toBeCloseTo(55 + 1 / 30, 5);
    } finally {
      cleanup();
    }
  });

  it("leaves keys typed in a field, and keys pressed in a dialog, to them", async () => {
    const { video, press, cleanup } = await playerAt(
      50,
      <>
        <input aria-label="Add a tag" />
        <div role="dialog">
          <button type="button">Remove</button>
        </div>
      </>,
    );
    try {
      press("l", screen.getByLabelText("Add a tag"));
      expect(video.currentTime).toBe(50);
      const inDialog = screen.getByRole("button", { name: "Remove" });
      act(() => {
        inDialog.focus();
      });
      press("l", inDialog);
      press("ArrowRight", inDialog);
      expect(video.currentTime).toBe(50);
    } finally {
      cleanup();
    }
  });

  it("jumps to the highlight and plays with Enter, in the player and page-wide", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { video, press, seekTo, cleanup } = await playerAt(10, <p>The description</p>, 60);
    try {
      press("Enter");
      expect(video.currentTime).toBe(60);
      await vi.waitFor(() => {
        expect(play).toHaveBeenCalled();
      });
      seekTo(10);
      press("Enter", screen.getByText("The description"));
      expect(video.currentTime).toBe(60);
    } finally {
      cleanup();
    }
  });

  it("leaves Enter alone past the highlight and without one", async () => {
    const past = await playerAt(70, null, 60);
    try {
      past.press("Enter");
      expect(past.video.currentTime).toBe(70);
    } finally {
      past.cleanup();
    }
    const none = await playerAt(10);
    try {
      none.press("Enter");
      expect(none.video.currentTime).toBe(10);
    } finally {
      none.cleanup();
    }
  });

  it("leaves Enter to a field, a dialog and a focused button", async () => {
    const { video, skin, press, cleanup } = await playerAt(
      10,
      <>
        <input aria-label="Add a tag" />
        <div role="dialog" tabIndex={-1} aria-label="Share">
          A dialog
        </div>
      </>,
      60,
    );
    try {
      press("Enter", screen.getByLabelText("Add a tag"));
      expect(video.currentTime).toBe(10);
      const dialog = screen.getByRole("dialog", { name: "Share" });
      act(() => {
        dialog.focus();
      });
      press("Enter", dialog);
      expect(video.currentTime).toBe(10);
      // Enter on one of the player's own buttons presses that button instead.
      const button = skin.querySelector("button");
      if (button === null) throw new Error("no button in the player");
      act(() => {
        button.focus();
      });
      press("Enter", button);
      expect(video.currentTime).toBe(10);
    } finally {
      cleanup();
    }
  });

  it("plays and pauses with k", async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const { press, cleanup } = await playerAt(0);
    try {
      press("k");
      await vi.waitFor(() => {
        expect(play).toHaveBeenCalled();
      });
    } finally {
      cleanup();
    }
  });

  it("reports a media error once, so the page can play it another way", async () => {
    const onError = vi.fn();
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
        onError={onError}
      />,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "error", {
      configurable: true,
      get: () => ({ code: 4, message: "MEDIA_ERR_SRC_NOT_SUPPORTED" }),
    });
    act(() => {
      video.dispatchEvent(new Event("error"));
    });
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    act(() => {
      video.dispatchEvent(new Event("error"));
    });
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
