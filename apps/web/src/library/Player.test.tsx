import { render } from "@testing-library/react";
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
});
