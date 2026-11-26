import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID as ID, itemFixture as item } from "@/test/libraryItem";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";

/**
 * How the watch page plays an item (docs/transcoding.md): the original as it is, a session at a
 * picked quality or when the original fails here, and the Stats panel that says which.
 */

// jsdom plays nothing; these pages are about a browser that plays the original.
vi.mock("./playable", () => ({
  canPlayOriginal: () => true,
  hasNativeHls: () => false,
  capabilities: () => ({ copyVideo: true, copyAudio: true }),
}));

vi.mock("./Player", () => import("@/test/fakePlayer"));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ItemPage playback", () => {
  const SID = "0190a3f2-7c1e-7000-8000-00000000005e";
  const url = `/api/library/${ID}/playback/sessions/${SID}`;
  const session = (over: Record<string, unknown>) => ({
    id: SID,
    state: "running",
    mode: "encode",
    quality: "720",
    encoder: "nvenc",
    width: 1280,
    height: 720,
    bitrate: null,
    reason: "picked",
    url,
    masterUrl: `${url}/master.m3u8`,
    error: null,
    ...over,
  });
  const offered = { ...item, qualities: ["1080", "720", "480"] };

  /** What the Stats panel says about how the video plays, once it is turned on. */
  const playback = async () => {
    if (screen.queryByRole("region", { name: "Playback stats" }) === null) {
      await userEvent.click(screen.getByRole("button", { name: "stats" }));
    }
    const panel = screen.getByRole("region", { name: "Playback stats" });
    return within(panel).getByText("Playback").nextElementSibling?.textContent;
  };

  it("plays the original as it is, and says so in the Stats panel, not under the player", async () => {
    fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(offered) });
    await renderInRouter(<ItemPage entryId={ID} />);
    expect(await screen.findByTestId("player")).toHaveAttribute("data-src", item.streamUrl);
    expect(screen.queryByText("Direct play")).toBeNull();
    expect(await playback()).toBe("Direct play");
    await userEvent.click(screen.getByRole("button", { name: "Close stats" }));
    expect(screen.queryByRole("region", { name: "Playback stats" })).toBeNull();
  });

  it("transcodes at a picked quality from where the viewer is", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(offered),
      [`POST /api/library/${ID}/playback`]: () => Response.json(session({}), { status: 201 }),
      [`GET ${url}`]: () => Response.json(session({})),
      [`DELETE ${url}`]: () => new Response(null, { status: 204 }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "play to 0:30" }));
    await userEvent.click(screen.getByRole("button", { name: "quality 720p" }));
    await waitFor(() => {
      expect(screen.getByTestId("player")).toHaveAttribute("data-src", `${url}/master.m3u8`);
    });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      quality: "720",
      start: 30,
      copyVideo: true,
      copyAudio: true,
    });
    expect(screen.getByTestId("player")).toHaveAttribute("data-start", "30");
    expect(await playback()).toBe("Transcoding to 720p · NVIDIA GPU");
    await userEvent.click(screen.getByRole("button", { name: "quality Original" }));
    await waitFor(() => {
      expect(screen.getByTestId("player")).toHaveAttribute("data-src", item.streamUrl);
    });
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path === url)).toBe(true);
    });
  });

  it("transcodes the original when it fails to play here, from where it stopped", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () => Response.json(offered),
      [`POST /api/library/${ID}/playback`]: () =>
        Response.json(
          session({ quality: "original", reason: "video_unsupported", encoder: "libx264" }),
          {
            status: 201,
          },
        ),
      [`GET ${url}`]: () =>
        Response.json(
          session({ quality: "original", reason: "video_unsupported", encoder: "libx264" }),
        ),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "play to 0:30" }));
    await userEvent.click(screen.getByRole("button", { name: "fail to play" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        quality: "original",
        start: 30,
        copyVideo: false,
        copyAudio: true,
      });
    });
    await waitFor(async () => {
      expect(await playback()).toBe("Transcoding to 720p · CPU · this browser can't play H.264");
    });
  });
});
