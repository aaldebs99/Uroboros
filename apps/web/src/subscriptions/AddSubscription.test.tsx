import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "@/router";
import { fakeApi, type Handler } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { NewSubscriptionPage } from "./NewSubscriptionPage";

const REQ = "0190a3f2-7c1e-7000-8000-0000000000d7";

const request = (over: Record<string, unknown>) => ({
  id: REQ,
  url: "https://www.youtube.com/@LinusTechTips",
  profileId: "0190a3f2-7c1e-7000-8000-000000000001",
  state: "probing",
  kind: null,
  title: null,
  groups: [],
  errorKind: null,
  errorMessage: null,
  stderrTail: [],
  retryAt: null,
  selected: null,
  createdAt: "2026-11-23T08:00:00.000Z",
  ...over,
});

const shell: Record<string, Handler> = {
  "GET /api/info": () => Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
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
  "GET /api/subscriptions": () => Response.json([]),
  "GET /api/format-profiles": () => Response.json([]),
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Add subscription", () => {
  it("posts the link as a subscription and goes straight to its settings page", async () => {
    const calls = fakeApi({
      ...shell,
      "POST /api/downloads": () => Response.json(request({}), { status: 202 }),
      [`GET /api/downloads/requests/${REQ}`]: () => Response.json(request({})),
    });
    const router = createAppRouter(createMemoryHistory({ initialEntries: ["/subscriptions"] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const [add] = await screen.findAllByRole("button", { name: "Add subscription" });
    if (add === undefined) throw new Error("no Add subscription button");
    await userEvent.click(add);
    const dialog = screen.getByRole("dialog", { name: "Add a subscription" });
    await userEvent.type(
      within(dialog).getByLabelText("Channel or playlist link"),
      "https://www.youtube.com/@LinusTechTips",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(router.state.location.href).toBe(`/subscriptions/new?request=${REQ}`);
    });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      url: "https://www.youtube.com/@LinusTechTips",
      intent: "subscribe",
    });
    expect(await screen.findByText(/Looking at the link/)).toBeInTheDocument();
  });

  it("says a single video can't be subscribed to, and a failed check why", async () => {
    fakeApi({
      [`GET /api/downloads/requests/${REQ}`]: () =>
        Response.json(request({ state: "failed", kind: "video", errorKind: "not_a_feed" })),
    });
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    expect(await screen.findByText(/That's a single video/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subscriptions" })).toHaveAttribute(
      "href",
      "/subscriptions",
    );
  });

  it("leads back to Subscriptions while the link is looked at", async () => {
    fakeApi({ [`GET /api/downloads/requests/${REQ}`]: () => Response.json(request({})) });
    await renderInRouter(<NewSubscriptionPage requestId={REQ} />);
    expect(await screen.findByText(/Looking at the link/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Subscriptions" })).toHaveAttribute(
      "href",
      "/subscriptions",
    );
  });
});
