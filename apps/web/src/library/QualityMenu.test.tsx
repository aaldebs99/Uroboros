import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Player } from "./Player";
import { QualityMenu } from "./QualityMenu";

const noop = () => undefined;
const options = [
  { value: "original", label: "Original" },
  { value: "720", label: "720p" },
  { value: "480", label: "480p" },
];

function renderPlayer(onChange: (v: string) => void, value = "original") {
  return render(
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
      settings={<QualityMenu value={value} options={options} onChange={onChange} />}
    />,
  );
}

// jsdom has no popover API, so the skin's menus stay "hidden" to it even when open: query with
// hidden elements included.
const hidden = { hidden: true } as const;

describe("QualityMenu", () => {
  it("sits in the player's settings menu, showing the current quality", () => {
    renderPlayer(noop, "720");
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    const trigger = screen.getByRole("menuitem", { name: /quality/i, ...hidden });
    expect(trigger).toHaveTextContent("720p");
  });

  it("lists Original and the offered rungs, and reports the pick", () => {
    const onChange = vi.fn();
    renderPlayer(onChange);
    fireEvent.click(screen.getByRole("button", { name: /settings/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /quality/i, ...hidden }));
    const items = screen.getAllByRole("menuitemradio", hidden);
    expect(items.map((i) => i.textContent)).toEqual(["Original", "720p", "480p"]);
    expect(
      within(items[0] as HTMLElement)
        .getByText("Original")
        .closest("[role=menuitemradio]"),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "480p", ...hidden }));
    expect(onChange).toHaveBeenCalledWith("480");
  });
});
