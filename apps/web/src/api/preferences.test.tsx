import { act, waitFor } from "@testing-library/react";
import { DEFAULT_SPONSORBLOCK, DEFAULT_SPONSORBLOCK_COLORS } from "@uroboros/contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID, itemFixture } from "@/test/libraryItem";
import { renderWithQuery } from "@/test/render";

import { useItem } from "./library";
import { useUpdatePreferences } from "./preferences";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("changing the SponsorBlock setting", () => {
  it("fetches an open item again, so its player shows and skips by the new setting", async () => {
    const prefs = {
      hidePlaylistVideos: false,
      sponsorBlock: DEFAULT_SPONSORBLOCK,
      sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
    };
    const calls = fakeApi({
      [`GET /api/library/${ITEM_ID}`]: () => Response.json(itemFixture),
      "PATCH /api/me/preferences": () => Response.json(prefs),
    });
    let save: ReturnType<typeof useUpdatePreferences> | undefined;
    function Page() {
      useItem(ITEM_ID);
      save = useUpdatePreferences();
      return null;
    }
    renderWithQuery(<Page />);
    const itemGets = () =>
      calls.filter((c) => c.method === "GET" && c.path === `/api/library/${ITEM_ID}`);
    await waitFor(() => {
      expect(itemGets()).toHaveLength(1);
    });
    act(() => {
      save?.mutate({ sponsorBlock: DEFAULT_SPONSORBLOCK });
    });
    await waitFor(() => {
      expect(itemGets()).toHaveLength(2);
    });
  });
});
