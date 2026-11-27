import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { ChannelPage } from "./ChannelPage";
import { ChannelsPage } from "./ChannelsPage";

/** Hiding a channel from the library (docs/library.md "Hiding from the library"). */

const KEY = "WyJ5b3V0dWJlIiwiaWQiLCJVQzEiXQ";
const OTHER = "WyJ5b3V0dWJlIiwiaWQiLCJVQzIiXQ";

const channel = (over: Record<string, unknown> = {}) => ({
  key: KEY,
  name: "Blender",
  extractor: "youtube",
  count: 3,
  latestUpload: null,
  coverThumbnailUrl: null,
  hideFromLibrary: false,
  ...over,
});

const ok = () => new Response(null, { status: 204 });

afterEach(() => {
  vi.unstubAllGlobals();
  toast.dismiss();
});

async function renderChannel() {
  await renderInRouter(
    <>
      <Toaster />
      <ChannelPage channelKey={KEY} />
    </>,
  );
}

describe("hiding a channel from the library", () => {
  it("hides a channel's videos from its page, and says what it did", async () => {
    const calls = fakeApi({
      "GET /api/library/channels": () => Response.json([channel()]),
      "GET /api/library": () => Response.json({ entries: [], nextCursor: null }),
      [`PUT /api/library/channels/${KEY}/hidden`]: ok,
    });
    await renderChannel();
    const toggle = await screen.findByRole("button", { name: "Hide from library" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ hidden: true });
    });
    expect(await screen.findByText("Its videos are hidden from your library.")).toBeInTheDocument();
  });

  it("shows a hidden channel's videos again, and says it is hidden until then", async () => {
    const calls = fakeApi({
      "GET /api/library/channels": () => Response.json([channel({ hideFromLibrary: true })]),
      "GET /api/library": () => Response.json({ entries: [], nextCursor: null }),
      [`PUT /api/library/channels/${KEY}/hidden`]: ok,
    });
    await renderChannel();
    expect(await screen.findByText("3 downloaded · Hidden from library")).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Hide from library" });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ hidden: false });
    });
    expect(await screen.findByText("Its videos show in your library again.")).toBeInTheDocument();
  });

  it("says when hiding failed", async () => {
    fakeApi({
      "GET /api/library/channels": () => Response.json([channel()]),
      "GET /api/library": () => Response.json({ entries: [], nextCursor: null }),
      [`PUT /api/library/channels/${KEY}/hidden`]: () =>
        Response.json(
          { code: "not_found", message: "no such channel in your library" },
          { status: 404 },
        ),
    });
    await renderChannel();
    await userEvent.click(await screen.findByRole("button", { name: "Hide from library" }));
    expect(await screen.findByText(/no such channel in your library/)).toBeInTheDocument();
  });

  it("marks a hidden channel's tile on Channels", async () => {
    fakeApi({
      "GET /api/library/channels": () =>
        Response.json([
          channel({ hideFromLibrary: true }),
          channel({ key: OTHER, name: "Kept", count: 1 }),
        ]),
    });
    await renderInRouter(<ChannelsPage />);
    const hidden = (await screen.findByText("Blender")).closest("li") as HTMLElement;
    expect(within(hidden).getByText("3 downloaded · Hidden from library")).toBeInTheDocument();
    const shown = screen.getByText("Kept").closest("li") as HTMLElement;
    expect(within(shown).queryByText(/Hidden from library/)).toBeNull();
  });
});
