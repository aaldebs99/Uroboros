import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SPONSORBLOCK, DEFAULT_SPONSORBLOCK_COLORS } from "@uroboros/contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../router";
import { fakeApi } from "../test/fakeApi";

function renderAt(path: string) {
  fakeApi({
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
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
    "GET /api/me/notifications": () =>
      Response.json({ downloads: true, shares: true, groups: true }),
    "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [] }),
    "GET /api/me/tokens": () => Response.json({ mcp: { enabled: true }, tokens: [] }),
    "GET /api/me/preferences": () =>
      Response.json({
        sponsorBlock: DEFAULT_SPONSORBLOCK,
        sponsorBlockColors: DEFAULT_SPONSORBLOCK_COLORS,
      }),
  });
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("Settings", () => {
  it("has a SponsorBlock view at its own address", async () => {
    const router = renderAt("/settings");
    const tabs = await screen.findByRole("navigation", { name: "Settings views" });
    await userEvent.click(within(tabs).getByRole("link", { name: "SponsorBlock" }));
    expect(await screen.findByRole("heading", { name: "SponsorBlock" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/sponsorblock");
  });

  it("opens on Notifications, and the Logins tab has its own address", async () => {
    const router = renderAt("/settings");
    const tabs = await screen.findByRole("navigation", { name: "Settings views" });
    expect(within(tabs).getByRole("link", { name: "Notifications" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    await userEvent.click(within(tabs).getByRole("link", { name: "Logins" }));
    expect(await screen.findByRole("heading", { name: "Site logins" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/logins");
    const after = screen.getByRole("navigation", { name: "Settings views" });
    expect(within(after).getByRole("link", { name: "Logins" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("keeps API tokens under the Tokens tab, made from a New token dialog", async () => {
    const router = renderAt("/settings");
    const tabs = await screen.findByRole("navigation", { name: "Settings views" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Notifications", "Logins", "Profiles", "SponsorBlock", "Groups", "Tokens"]);
    await userEvent.click(within(tabs).getByRole("link", { name: "Tokens" }));
    expect(await screen.findByRole("heading", { name: "API tokens" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/tokens");
    await userEvent.click(await screen.findByRole("button", { name: "New token" }));
    expect(await screen.findByRole("dialog", { name: "New token" })).toBeInTheDocument();
  });

  it("lists its views under Settings in the side navigation, the current one filled", async () => {
    const router = renderAt("/settings/logins");
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    const views = within(nav).getByRole("list", { name: "Settings views" });
    expect(within(views).getByRole("link", { name: "Logins" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(views).getByRole("link", { name: "Notifications" })).not.toHaveAttribute(
      "aria-current",
    );
    await userEvent.click(within(views).getByRole("link", { name: "Notifications" }));
    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings");
  });
});
