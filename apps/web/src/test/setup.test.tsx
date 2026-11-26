import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { Player } from "@/library/Player";

const noop = () => undefined;

// setup.ts: jsdom's media elements have no audio track list, as in Chrome and Firefox, so the
// player's store attaches to them without an error. Vitest prints a passing test's console
// output only with the verbose reporter, so this would otherwise go unseen.
it("lets a player attach its store to jsdom's video without an error", () => {
  const error = vi.spyOn(console, "error");
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
    />,
  );
  expect(error.mock.calls.filter(([first]) => first === "[vjs-store]")).toEqual([]);
});
