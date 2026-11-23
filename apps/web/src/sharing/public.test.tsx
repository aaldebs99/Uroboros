import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../router";
import { fakeApi } from "../test/fakeApi";

const playable = vi.hoisted(() => ({ original: true }));
vi.mock("../library/playable", () => ({
  canPlayOriginal: () => playable.original,
  hasNativeHls: () => false,
}));
vi.mock("../library/Player", () => ({
  Player: (props: { src: string; onEnded: () => void }) => (
    <div>
      <div data-testid="player" data-src={props.src} />
      <button type="button" onClick={props.onEnded}>
        end the video
      </button>
    </div>
  ),
}));

const CODE = "AbCdEfGhIjKlMnOpQrStUv";
const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const base = (n: number) => `/api/public/s/${CODE}/items/${id(n)}`;
const listItem = (n: number) => ({
  id: id(n),
  title: `Film ${String(n)}`,
  channel: "Blender",
  duration: 60,
  uploadDate: null,
  thumbnailUrl: null,
});
const item = (n: number, fileUrl: string | null = null) => ({
  ...listItem(n),
  description: "An open movie.",
  chapters: [],
  subtitles: [],
  streamUrl: `${base(n)}/stream`,
  fileUrl,
  container: "webm",
  videoCodec: "vp9",
  audioCodec: "opus",
  playbackUrl: `${base(n)}/playback`,
});

/** The whole app at `/s/<code>`, signed out: `/api/me` is 401. */
async function openLink() {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [`/s/${CODE}`] }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await router.load();
}

const signedOut = {
  "GET /api/me": () => Response.json({ code: "unauthorized", message: "sign in" }, { status: 401 }),
  "GET /api/auth/methods": () => Response.json({ local: true, oidc: null }),
};

afterEach(() => {
  playable.original = true;
  vi.unstubAllGlobals();
});

describe("a public link", () => {
  it("plays the video signed out, with no sign-in page", async () => {
    fakeApi({
      ...signedOut,
      [`GET /api/public/s/${CODE}`]: () =>
        Response.json({
          kind: "entry",
          title: "Film 1",
          description: null,
          allowDownload: false,
          items: [listItem(1)],
        }),
      [`GET ${base(1)}`]: () => Response.json(item(1)),
    });
    await openLink();
    expect(await screen.findByRole("heading", { name: "Film 1" })).toBeInTheDocument();
    expect(await screen.findByTestId("player")).toHaveAttribute("data-src", `${base(1)}/stream`);
    expect(screen.queryByRole("button", { name: /Sign in/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();
  });

  it("offers Download only when the link allows it", async () => {
    fakeApi({
      ...signedOut,
      [`GET /api/public/s/${CODE}`]: () =>
        Response.json({
          kind: "entry",
          title: "Film 1",
          description: null,
          allowDownload: true,
          items: [listItem(1)],
        }),
      [`GET ${base(1)}`]: () => Response.json(item(1, `${base(1)}/file`)),
    });
    await openLink();
    expect(await screen.findByRole("link", { name: /Download/ })).toHaveAttribute(
      "href",
      `${base(1)}/file`,
    );
  });

  it("plays a playlist's next video when one ends", async () => {
    const calls = fakeApi({
      ...signedOut,
      [`GET /api/public/s/${CODE}`]: () =>
        Response.json({
          kind: "playlist",
          title: "Two films",
          description: null,
          allowDownload: false,
          items: [listItem(1), listItem(2)],
        }),
      [`GET ${base(1)}`]: () => Response.json(item(1)),
      [`GET ${base(2)}`]: () => Response.json(item(2)),
    });
    await openLink();
    expect(await screen.findByText("Two films")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Film 2/ })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "end the video" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === base(2))).toBe(true);
    });
    expect(await screen.findByRole("heading", { name: "Film 2" })).toBeInTheDocument();
  });

  it("a link turned off while watching shows the dead-link page", async () => {
    fakeApi({
      ...signedOut,
      [`GET /api/public/s/${CODE}`]: () =>
        Response.json({
          kind: "playlist",
          title: "Two films",
          description: null,
          allowDownload: false,
          items: [listItem(1), listItem(2)],
        }),
      [`GET ${base(1)}`]: () => Response.json(item(1)),
    });
    await openLink();
    await userEvent.click(await screen.findByRole("button", { name: /Film 2/ }));
    expect(await screen.findByText("This link doesn't work any more")).toBeInTheDocument();
  });

  it("an empty playlist link says so", async () => {
    fakeApi({
      ...signedOut,
      [`GET /api/public/s/${CODE}`]: () =>
        Response.json({
          kind: "playlist",
          title: "Empty",
          description: null,
          allowDownload: false,
          items: [],
        }),
    });
    await openLink();
    expect(await screen.findByText("Nothing in this playlist yet")).toBeInTheDocument();
  });

  it("says a dead link doesn't work", async () => {
    fakeApi(signedOut);
    await openLink();
    expect(await screen.findByText("This link doesn't work any more")).toBeInTheDocument();
  });

  it("asks for the compatible copy through the link", async () => {
    playable.original = false;
    const calls = fakeApi({
      ...signedOut,
      [`GET /api/public/s/${CODE}`]: () =>
        Response.json({
          kind: "entry",
          title: "Film 1",
          description: null,
          allowDownload: false,
          items: [listItem(1)],
        }),
      [`GET ${base(1)}`]: () => Response.json(item(1)),
      [`POST ${base(1)}/playback`]: () =>
        Response.json({
          state: "running",
          mode: "encode",
          readySegments: 0,
          progress: 0.1,
          masterUrl: `${base(1)}/playback/master.m3u8`,
          error: null,
        }),
    });
    await openLink();
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === `${base(1)}/playback`)).toBe(true);
    });
  });
});
