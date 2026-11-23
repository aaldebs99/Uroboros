import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { CompatiblePlayer } from "./CompatiblePlayer";

vi.mock("./Player", () => ({
  Player: (props: { src: string; hls?: { native: boolean } }) => (
    <div
      data-testid="player"
      data-src={props.src}
      data-hls={props.hls === undefined ? "" : props.hls.native ? "native" : "mse"}
    />
  ),
}));

const ID = "0190a3f2-7c1e-7000-8000-0000000000c1";
const master = `/api/library/${ID}/playback/master.m3u8`;
const playback = (over: Record<string, unknown>) => ({
  state: "running",
  mode: "encode",
  readySegments: 0,
  progress: 0,
  masterUrl: master,
  error: null,
  ...over,
});
const props = {
  entryId: ID,
  title: "Big Buck Bunny",
  start: 0,
  autoPlay: true,
  seek: null,
  chapters: [],
  subtitles: [],
  onTime: () => undefined,
  onPause: () => undefined,
  onEnded: () => undefined,
};

describe("CompatiblePlayer", () => {
  it("shows real progress while the copy is made", async () => {
    fakeApi({
      [`POST /api/library/${ID}/playback`]: () => Response.json(playback({ progress: 0.34 })),
      [`GET /api/library/${ID}/playback`]: () => Response.json(playback({ progress: 0.34 })),
    });
    renderWithQuery(<CompatiblePlayer {...props} native={false} />);
    expect(
      await screen.findByText("Preparing a version this browser can play"),
    ).toBeInTheDocument();
    expect(await screen.findByRole("progressbar")).toHaveAttribute("aria-valuenow", "34");
    expect(screen.queryByTestId("player")).not.toBeInTheDocument();
  });

  it("plays natively once two segments are stored", async () => {
    fakeApi({
      [`POST /api/library/${ID}/playback`]: () => Response.json(playback({ readySegments: 2 })),
      [`GET /api/library/${ID}/playback`]: () => Response.json(playback({ readySegments: 2 })),
    });
    renderWithQuery(<CompatiblePlayer {...props} native />);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-src", master);
    expect(player).toHaveAttribute("data-hls", "native");
  });

  it("waits for the whole copy without native HLS", async () => {
    let polls = 0;
    fakeApi({
      [`POST /api/library/${ID}/playback`]: () => Response.json(playback({ readySegments: 5 })),
      [`GET /api/library/${ID}/playback`]: () =>
        Response.json(
          ++polls < 2 ? playback({ readySegments: 5 }) : playback({ state: "done", progress: 1 }),
        ),
    });
    renderWithQuery(<CompatiblePlayer {...props} native={false} />);
    expect(await screen.findByRole("progressbar")).toBeInTheDocument();
    const player = await screen.findByTestId("player", undefined, { timeout: 6000 });
    expect(player).toHaveAttribute("data-hls", "mse");
  }, 10_000);

  it("offers Try again after a failure", async () => {
    const calls = fakeApi({
      [`POST /api/library/${ID}/playback`]: () =>
        Response.json(playback({ state: "failed", error: "Error while decoding" })),
      [`GET /api/library/${ID}/playback`]: () =>
        Response.json(playback({ state: "failed", error: "Error while decoding" })),
    });
    renderWithQuery(<CompatiblePlayer {...props} native={false} />);
    expect(await screen.findByText(/Error while decoding/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    });
  });
});
