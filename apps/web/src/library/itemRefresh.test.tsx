import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { ITEM_ID as ID, itemFixture as item } from "@/test/libraryItem";
import { renderInRouter } from "@/test/render";

import { ItemPage } from "./ItemPage";

// Nothing here is about playback: no player.
vi.mock("./Player", () => ({ Player: () => null }));

const REFRESH = `/api/library/${ID}/skip-segments/refresh`;

describe("ItemPage's quiet SponsorBlock refresh (docs/automation.md#sponsorblock)", () => {
  it("asks for one as the page of the person's own refetchable video opens", async () => {
    const calls = fakeApi({
      [`GET /api/library/${ID}`]: () =>
        Response.json({ ...item, sponsorSegmentsRefetchable: true }),
      [`POST ${REFRESH}`]: () => new Response(null, { status: 202 }),
    });
    await renderInRouter(<ItemPage entryId={ID} />);
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "POST" && c.path === REFRESH)).toHaveLength(1);
    });
    // Quietly: no toast, nothing on the page says so.
    expect(screen.queryByText(/SponsorBlock/)).toBeNull();
  });

  it("asks for none on a video with no segments to fetch", async () => {
    const calls = fakeApi({ [`GET /api/library/${ID}`]: () => Response.json(item) });
    await renderInRouter(<ItemPage entryId={ID} />);
    await screen.findByRole("button", { name: "Share" });
    expect(calls.some((c) => c.path === REFRESH)).toBe(false);
  });
});
