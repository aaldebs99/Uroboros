import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exportsKey } from "@/api/exports";
import { itemKey } from "@/api/library";
import { followLiveEvents, type LiveMessage } from "@/api/liveEvents";
import { Toaster } from "@/components/ui/sonner";

import { LiveEventsProvider } from "./LiveEvents";

vi.mock("@/api/liveEvents", () => ({ followLiveEvents: vi.fn() }));

const ENTRY = "0190a3f2-7c1e-7000-8000-0000000000c1";

afterEach(() => {
  vi.mocked(followLiveEvents).mockReset();
});

/** The provider on a client holding the entry and the person's copies; returns its stream. */
function renderLive() {
  let deliver: (m: LiveMessage) => void = () => undefined;
  vi.mocked(followLiveEvents).mockImplementation((onMessage) => {
    deliver = onMessage;
    return () => undefined;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(itemKey(ENTRY), { id: ENTRY });
  client.setQueryData(exportsKey, []);
  render(
    <QueryClientProvider client={client}>
      <LiveEventsProvider>
        <Toaster />
      </LiveEventsProvider>
    </QueryClientProvider>,
  );
  return {
    client,
    deliver: (m: LiveMessage) => {
      act(() => {
        deliver(m);
      });
    },
  };
}

describe("LiveEventsProvider", () => {
  it("fetches the entry and the person's copies again after a SponsorBlock refetch, and says how it went", async () => {
    const { client, deliver } = renderLive();
    deliver({ kind: "event", event: { type: "skips", entryId: ENTRY, found: 3, error: null } });
    // A copy cut from the old segments is no longer current: Save must not hand it out.
    expect(client.getQueryState(exportsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(itemKey(ENTRY))?.isInvalidated).toBe(true);
    expect(await screen.findByText("Found 3 SponsorBlock segments to skip")).toBeInTheDocument();
  });
});
