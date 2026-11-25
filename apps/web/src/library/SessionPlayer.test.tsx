import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { SessionPlayer } from "./SessionPlayer";

let lastOnError: (() => void) | undefined;
let lastOnTime: ((at: number, duration: number) => void) | undefined;
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./Player", async () => {
  const { useEffect } = await import("react");
  return {
    Player: (props: {
      src: string;
      hls?: { native: boolean };
      start: number;
      onError?: () => void;
      onTime: (at: number, duration: number) => void;
    }) => {
      lastOnError = props.onError;
      lastOnTime = props.onTime;
      useEffect(() => {
        mounts.count++;
      }, []);
      return (
        <div
          data-testid="player"
          data-src={props.src}
          data-hls={props.hls === undefined ? "" : props.hls.native ? "native" : "mse"}
          data-start={String(props.start)}
        />
      );
    },
  };
});

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

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("shows why a session failed once its own retry failed too, and tries again on request", async () => {
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
    // The first failure starts a new session by itself; only the second one stays on screen.
    await waitFor(() => {
      expect(posts).toBe(2);
    });
    expect(await screen.findByText(/couldn't be played: libx264: broken/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(posts).toBe(3);
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
    // The new one is gone too, within 30 s of the last restart: it says so rather than loop.
    expect(
      await screen.findByText(/couldn't be played: the playback session ended/),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
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
    // A second failure within 30 s of that restart shows, with no third session.
    await screen.findByTestId("player");
    lastOnError?.();
    expect(
      await screen.findByText(/couldn't be played: the player could not play it/),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
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

  it("keeps playing while its session moves to another replica (queued again after running)", async () => {
    // The first poll's "queued" is held until the player has played: answered before that, it is
    // a session that never ran, and the race between the two remounted the player now and then.
    let played: () => void = () => undefined;
    const hasPlayed = new Promise<void>((resolve) => {
      played = resolve;
    });
    let polls = 0;
    fakeApi({
      [`POST ${base}`]: () => Response.json(session(), { status: 201 }),
      [`GET ${url}`]: async () => {
        await hasPlayed;
        return Response.json(++polls === 1 ? session({ state: "queued" }) : session());
      },
    });
    mounts.count = 0;
    renderWithQuery(<SessionPlayer {...props} />);
    await screen.findByTestId("player");
    lastOnTime?.(44, 120);
    played();
    await waitFor(
      () => {
        expect(polls).toBeGreaterThanOrEqual(2);
      },
      { timeout: 4000 },
    );
    expect(screen.getByTestId("player")).toBeInTheDocument();
    expect(mounts.count).toBe(1);
  });

  it("retries a failed session once by itself", async () => {
    let posts = 0;
    const failed = session({ state: "failed", error: "the transcoder's output changed" });
    const calls = fakeApi({
      [`POST ${base}`]: () => Response.json(++posts === 1 ? failed : session(), { status: 201 }),
      [`GET ${url}`]: () => Response.json(posts === 1 ? failed : session()),
    });
    renderWithQuery(<SessionPlayer {...props} />);
    expect(await screen.findByTestId("player", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
  });

  it("recovers again when its session is lost long after the last recovery", async () => {
    let now = Date.parse("2026-11-23T10:00:00Z");
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let posts = 0;
    const calls = fakeApi({
      [`POST ${base}`]: () => {
        posts++;
        // The second session is lost a minute later.
        if (posts === 2) now += 60_000;
        return Response.json(session(), { status: 201 });
      },
      [`GET ${url}`]: () =>
        posts < 3
          ? Response.json({ code: "not_found", message: "gone" }, { status: 404 })
          : Response.json(session()),
    });
    renderWithQuery(<SessionPlayer {...props} />);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
    });
    expect(await screen.findByTestId("player")).toBeInTheDocument();
  });
});
