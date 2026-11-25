import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { itemFixture } from "@/test/libraryItem";

import { Player, type PlayerProps } from "./Player";
import { WatchPlayer } from "./WatchPlayer";

// jsdom plays nothing; the watch player here is in a browser that plays the original.
vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));

const noop = () => undefined;

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

const artOf = (container: HTMLElement) => container.querySelector("[data-audio-art]");

describe("Player for a file with sound alone", () => {
  it("shows its thumbnail where the picture would be, out of the screen reader's way", () => {
    const { container } = render(<Player {...props} audio={{ thumbnailUrl: "/t.jpg" }} />);
    const art = artOf(container);
    expect(art).not.toBeNull();
    expect(art).toHaveAttribute("aria-hidden", "true");
    const images = Array.from(art?.querySelectorAll("img") ?? []);
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) expect(img).toHaveAttribute("src", "/t.jpg");
  });

  it("shows no image when it has no thumbnail", () => {
    const { container } = render(<Player {...props} audio={{ thumbnailUrl: null }} />);
    expect(artOf(container)).not.toBeNull();
    expect(artOf(container)?.querySelector("img")).toBeNull();
  });

  it("shows nothing over a video's picture", () => {
    const { container } = render(<Player {...props} />);
    expect(artOf(container)).toBeNull();
  });
});

describe("WatchPlayer", () => {
  // No tracks: jsdom's text track lists take no listeners.
  const watch = (item: typeof itemFixture) =>
    render(
      <WatchPlayer
        item={{ ...item, subtitles: [], chapters: [] }}
        start={0}
        autoPlay={false}
        seek={null}
        onTime={noop}
        onPause={noop}
        onEnded={noop}
      />,
    );

  it("gives a file with no video stream its thumbnail as artwork", async () => {
    const { container } = watch({ ...itemFixture, videoCodec: null, thumbnailUrl: "/t.jpg" });
    await waitFor(() => {
      expect(container.querySelector("[data-audio-art] img")).toHaveAttribute("src", "/t.jpg");
    });
  });

  it("gives a video none", async () => {
    const { container } = watch({ ...itemFixture, thumbnailUrl: "/t.jpg" });
    await waitFor(() => {
      expect(container.querySelector("video")).not.toBeNull();
    });
    expect(artOf(container)).toBeNull();
  });
});
