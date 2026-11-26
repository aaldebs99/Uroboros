import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Player } from "./Player";
import { PlayerSettings } from "./PlayerSettings";

/** The watch player's settings menu: Quality, when the video offers more than one, and Stats. */

const noop = () => undefined;
const quality = {
  value: "original",
  options: [
    { value: "original", label: "Original" },
    { value: "720", label: "720p" },
  ],
  onChange: noop,
};

function renderPlayer(settings: React.ReactNode) {
  render(
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
      settings={settings}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /settings/i }));
}

// jsdom has no popover API, so the skin's menus stay "hidden" to it even when open.
const hidden = { hidden: true } as const;

describe("PlayerSettings", () => {
  it("turns the Stats panel on and off from the settings menu, saying which it is", () => {
    const onStats = vi.fn();
    renderPlayer(<PlayerSettings quality={quality} stats={false} onStats={onStats} />);
    const stats = screen.getByRole("menuitem", { name: /stats/i, ...hidden });
    expect(stats).toHaveTextContent("Off");
    fireEvent.click(stats);
    expect(onStats).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menuitem", { name: /quality/i, ...hidden })).toHaveTextContent(
      "Original",
    );
  });

  it("says On while the panel shows, and offers Stats alone for a video with no qualities", () => {
    renderPlayer(<PlayerSettings quality={null} stats onStats={noop} />);
    expect(screen.getByRole("menuitem", { name: /stats/i, ...hidden })).toHaveTextContent("On");
    expect(screen.queryByRole("menuitem", { name: /quality/i, ...hidden })).toBeNull();
  });
});
