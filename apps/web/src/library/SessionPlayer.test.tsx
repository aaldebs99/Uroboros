import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { SessionPlayer } from "./SessionPlayer";

let lastOnError: (() => void) | undefined;
vi.mock("./Player", () => ({
  Player: (props: {
    src: string;
    hls?: { native: boolean };
    start: number;
    onError?: () => void;
  }) => {
    lastOnError = props.onError;
    return (
      <div
        data-testid="player"
        data-src={props.src}
        data-hls={props.hls === undefined ? "" : props.hls.native ? "native" : "mse"}
        data-start={String(props.start)}
      />
    );
  },
}));

const ID = "0190a3f2-7c1e-7000-8000-0000000000c1";
const SID = "0190a3f2-7c1e-7000-8000-00000000005e";
const base = `/api/library/${ID}/playback`;
const url = `${base}/sessions/${SID}`;
const session = (over: Record<string, unknown> = {}) => ({
  id: SID,
  state: "running",
  mode: "encode",
  quality: "720",
  encoder: "libx264",
  width: 1280,
  height: 720,
  reason: "picked",
  url,
  masterUrl: `${url}/master.m3u8`,
  error: null,
  ...over,
});
const props = {
  playbackUrl: base,
  request: { quality: "720" as const, start: 42, copyVideo: false, copyAudio: true },
  native: false,
  position: () => 50,
  title: "Big Buck Bunny",
  autoPlay: true,
  seek: null,
  chapters: [],
  subtitles: [],
  onTime: () => undefined,
  onPause: () => undefined,
  onEnded: () => undefined,
};

describe("SessionPlayer", () => {
  it("asks for the session from the viewer's position, and plays its playlist once it runs", async () => {
    let polls = 0;
    const calls = fakeApi({
      [`POST ${base}`]: () =>
        Response.json(session({ state: "queued", encoder: null }), { status: 201 }),
      [`GET ${url}`]: () => Response.json(++polls < 2 ? session({ state: "queued" }) : session()),
    });
    renderWithQuery(<SessionPlayer {...props} />);
    expect(await screen.findByText("Waiting for a free transcoder…")).toBeInTheDocument();
    const player = await screen.findByTestId("player", undefined, { timeout: 4000 });
    expect(player).toHaveAttribute("data-src", `${url}/master.m3u8`);
    expect(player).toHaveAttribute("data-hls", "mse");
    expect(player).toHaveAttribute("data-start", "42");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual(props.request);
  });

  it("says it is starting while the runner prepares", async () => {
    fakeApi({
      [`POST ${base}`]: () => Response.json(session({ state: "starting" }), { status: 201 }),
      [`GET ${url}`]: () => Response.json(session({ state: "starting" })),
    });
    renderWithQuery(<SessionPlayer {...props} native />);
    expect(await screen.findByText("Starting…")).toBeInTheDocument();
  });

  it("shows why a session failed, and tries again on request", async () => {
    let posts = 0;
    fakeApi({
      [`POST ${base}`]: () => {
        posts++;
        return Response.json(session({ state: "failed", error: "libx264: broken" }), {
          status: 201,
        });
      },
      [`GET ${url}`]: () => Response.json(session({ state: "failed", error: "libx264: broken" })),
    });
    renderWithQuery(<SessionPlayer {...props} />);
    expect(await screen.findByText(/couldn't be played: libx264: broken/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(posts).toBe(2);
    });
  });

  it("starts a new session at the current position when its own is gone, once", async () => {
    const calls = fakeApi({
      [`POST ${base}`]: () => Response.json(session(), { status: 201 }),
      [`GET ${url}`]: () => Response.json({ code: "not_found", message: "gone" }, { status: 404 }),
    });
    renderWithQuery(<SessionPlayer {...props} />);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === "POST")[1]?.body).toMatchObject({ start: 50 });
  });

  it("starts again at the current position when the player fails", async () => {
    const calls = fakeApi({
      [`POST ${base}`]: () => Response.json(session(), { status: 201 }),
      [`GET ${url}`]: () => Response.json(session()),
    });
    renderWithQuery(<SessionPlayer {...props} />);
    await screen.findByTestId("player");
    lastOnError?.();
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    });
    expect(calls.filter((c) => c.method === "POST")[1]?.body).toMatchObject({ start: 50 });
  });

  it("stops its session when it goes", async () => {
    const calls = fakeApi({
      [`POST ${base}`]: () => Response.json(session(), { status: 201 }),
      [`GET ${url}`]: () => Response.json(session()),
      [`DELETE ${url}`]: () => new Response(null, { status: 204 }),
    });
    const { unmount } = renderWithQuery(<SessionPlayer {...props} />);
    await screen.findByTestId("player");
    unmount();
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path === url)).toBe(true);
    });
  });
});
