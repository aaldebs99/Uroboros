import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../router";
import { fakeApi } from "../test/fakeApi";

/**
 * A public link to a video opened at a clip (docs/sharing.md#clips), `/s/<code>?t=&end=`: it
 * plays from the clip's start and marks it, with no Clip button for a viewer who isn't its owner.
 */

vi.mock("../library/playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));
vi.mock("../library/Player", () => import("../test/fakePlayer"));

beforeAll(async () => {
  await import("../library/Player");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CODE = "AbCdEfGhIjKlMnOpQrStUv";
const ID = "0190a3f2-7c1e-7000-8000-000000000001";
const base = `/api/public/s/${CODE}/items/${ID}`;
const listItem = {
  id: ID,
  title: "Film",
  channel: "Blender",
  duration: 600,
  uploadDate: null,
  thumbnailUrl: null,
};

function open(path: string) {
  fakeApi({
    "GET /api/me": () =>
      Response.json({ code: "unauthorized", message: "sign in" }, { status: 401 }),
    "GET /api/auth/methods": () => Response.json({ local: true, oidc: null }),
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "0", publicBaseUrl: null, clips: true }),
    [`GET /api/public/s/${CODE}`]: () =>
      Response.json({
        kind: "entry",
        title: "Film",
        description: null,
        allowDownload: false,
        items: [listItem],
      }),
    [`GET ${base}`]: () =>
      Response.json({
        ...listItem,
        description: null,
        chapters: [],
        sponsorSegments: [],
        sponsorHighlight: null,
        subtitles: [],
        streamUrl: `${base}/stream`,
        fileUrl: null,
        container: "mp4",
        videoCodec: "h264",
        audioCodec: "aac",
        playbackUrl: `${base}/playback`,
        videoCodecs: null,
        audioCodecs: null,
        width: null,
        height: null,
        qualities: [],
      }),
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("a public link opened at a clip", () => {
  it("plays from the clip's start and marks it, with no Clip button", async () => {
    open(`/s/${CODE}?t=62&end=90`);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-start", "62");
    await waitFor(() => {
      expect(player).toHaveAttribute("data-range", "62-90");
    });
    expect(player).toHaveAttribute("data-clip", "");
  });

  it("plays from the start without a clip", async () => {
    open(`/s/${CODE}`);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-start", "0");
    expect(player).toHaveAttribute("data-range", "");
  });
});
