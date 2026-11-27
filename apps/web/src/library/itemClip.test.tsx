import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "@/router";
import { fakeApi, type Handler } from "@/test/fakeApi";
import { ITEM_ID as ID, itemFixture as item } from "@/test/libraryItem";

/**
 * A link opening the whole video at a clip (docs/sharing.md#clips), `/library/<id>?t=&end=`: the
 * watch page starts at the clip and the player marks it; with clips off on the server, only `t`
 * counts, as before.
 */

vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));
vi.mock("./Player", () => import("@/test/fakePlayer"));

// The player is a lazy chunk: loaded here, a test's wait covers rendering it, not loading it.
beforeAll(async () => {
  await import("./Player");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const shell = (clips: boolean): Record<string, Handler> => ({
  "GET /api/info": () =>
    Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null, clips }),
  "GET /api/me": () =>
    Response.json({
      id: "0190a3f2-7c1e-7000-8000-000000000001",
      displayName: "Alice",
      email: null,
      role: "member",
      method: "local",
      isBootstrap: false,
    }),
  "GET /api/me/push": () =>
    Response.json({ enabled: false, publicKey: null, devices: [], maxDevices: 10 }),
  [`GET /api/library/${ID}`]: () => Response.json(item),
});

function open(path: string, clips: boolean) {
  fakeApi(shell(clips));
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("a link to a video opened at a clip", () => {
  it("starts at the clip and has the player mark it, beside the Clip button", async () => {
    open(`/library/${ID}?t=62&end=90`, true);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-start", "62");
    await waitFor(() => {
      expect(player).toHaveAttribute("data-range", "62-90");
    });
    expect(player).toHaveAttribute("data-clip", "on");
  });

  it("starts at t alone, with no clip and no Clip button, while clips are off", async () => {
    open(`/library/${ID}?t=62&end=90`, false);
    const player = await screen.findByTestId("player");
    expect(player).toHaveAttribute("data-start", "62");
    // The server's answer is in once the page knows the video; nothing waits for clips after it.
    await screen.findByRole("heading", { name: "Big Buck Bunny" });
    expect(player).toHaveAttribute("data-range", "");
    expect(player).toHaveAttribute("data-clip", "");
  });
});
