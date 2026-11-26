import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { itemFixture } from "@/test/libraryItem";

import { PlayerPlaceholder, WatchPlayer } from "./WatchPlayer";

/**
 * On phones the watch player runs edge to edge, as the library's thumbnails do: across the page's
 * 1rem gutter, with no corners; from md up it sits in the page with its rounded corners.
 */

// jsdom plays nothing; the watch player here is in a browser that plays the original.
vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));

const noop = () => undefined;

describe("the watch player on phones", () => {
  it("crosses the page's gutter to the screen's edges, with corners only from md up", async () => {
    const { container } = render(
      <WatchPlayer
        item={{ ...itemFixture, subtitles: [], chapters: [] }}
        start={0}
        autoPlay={false}
        seek={null}
        onTime={noop}
        onPause={noop}
        onEnded={noop}
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".uro-player")).not.toBeNull();
    });
    const skin = container.querySelector(".uro-player");
    expect(skin).toHaveClass("md:rounded-[0.75rem]");
    expect(skin).not.toHaveClass("rounded-[0.75rem]");
    expect(container.firstElementChild).toHaveClass("max-md:-mx-4");
  });

  it("gives the placeholder before it loads the same box", () => {
    const { container } = render(<PlayerPlaceholder />);
    const box = container.firstElementChild;
    expect(box).toHaveClass("max-md:-mx-4", "md:rounded-[0.75rem]", "aspect-video");
    // A full width would keep the parent's width and only shift it left.
    expect(box).not.toHaveClass("w-full");
    expect(box).toHaveAttribute("aria-busy", "true");
  });
});
