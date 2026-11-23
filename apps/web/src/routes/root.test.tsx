import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppRouter } from "../router";
import { stubApi } from "../test/render";

/** Renders the app at `path`, once the shell is up: its side navigation, or `ready`. */
async function renderAt(
  path: string,
  ready = () => screen.findByRole("navigation", { name: "Primary" }),
) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await ready();
  return router;
}

beforeEach(() => {
  stubApi({
    "/api/ready": () => Response.json({ status: "ok", failing: [] }),
    "/api/info": () => Response.json({ name: "uroboros", version: "0.0.0" }),
    "/api/me": () =>
      Response.json({
        id: "0190a3f2-7c1e-7000-8000-000000000001",
        displayName: "Alice",
        email: null,
        role: "member",
        method: "local",
        isBootstrap: false,
      }),
    "/api/me/push": () =>
      Response.json({ enabled: false, publicKey: null, devices: [], maxDevices: 10 }),
    "/api/subscriptions": () => Response.json([]),
  });
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("app shell", () => {
  it("renders the nav links, with the library's views indented under Library", async () => {
    await renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual([
      "Library",
      "Videos",
      "Channels",
      "Playlists",
      "Downloads",
      "Subscriptions",
      "Settings",
    ]);
  });

  it("marks the current library view, and hides the views on the mini rail", async () => {
    await renderAt("/library/channels");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const views = within(nav).getByRole("list", { name: "Library views" });
    expect(within(views).getByRole("link", { name: "Channels" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(views).getByRole("link", { name: "Videos" })).not.toHaveAttribute("aria-current");

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(within(nav).queryByRole("list", { name: "Library views" })).not.toBeInTheDocument();
  });

  it("navigating to /subscriptions shows the subscriptions", async () => {
    await renderAt("/settings");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    await userEvent.click(within(nav).getByRole("link", { name: "Subscriptions" }));

    expect(await screen.findByRole("heading", { name: "Subscriptions" })).toBeInTheDocument();
    expect(await screen.findByText("No subscriptions yet")).toBeInTheDocument();
  });

  it("puts the brand and the account menu in the top bar, and the nav below it", async () => {
    await renderAt("/");

    const header = screen.getByRole("banner");
    expect(within(header).getByText("Uroboros")).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Account menu for Alice" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(header).not.toContainElement(nav);
    expect(within(nav).queryByText("Uroboros")).not.toBeInTheDocument();
  });

  it("keeps the health status out of the top bar", async () => {
    await renderAt("/");

    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
  });

  it("shows the Notifications section in Settings", async () => {
    await renderAt("/settings");

    expect(await screen.findByRole("heading", { name: "Notifications" })).toBeInTheDocument();
    expect(await screen.findByText(/notifications are off on this server/i)).toBeInTheDocument();
  });

  it("picks a theme in the account menu's Appearance and remembers it", async () => {
    await renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Account menu for Alice" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Appearance/ }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

    expect(localStorage.getItem("uroboros-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("puts the bottom tabs on phones: Library, Downloads, Create, Subscriptions, You", async () => {
    await renderAt("/");

    const tabs = screen.getByRole("navigation", { name: "Tabs" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Library", "Downloads", "Subscriptions", "You"]);
    expect(within(tabs).getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("collapses the side navigation to the mini rail and remembers it", async () => {
    await renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));

    expect(screen.getByRole("button", { name: "Expand navigation" })).toBeInTheDocument();
    expect(localStorage.getItem("uroboros-nav-mini")).toBe("1");
  });

  it("puts the navigation in a drawer on a watch page, which any navigation closes", async () => {
    const router = await renderAt("/library/0190a3f2-7c1e-7000-8000-000000000200", () =>
      screen.findByRole("button", { name: "Open navigation" }),
    );
    expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = screen.getByRole("dialog", { name: "Navigation" });
    await userEvent.click(within(drawer).getByRole("link", { name: "Downloads" }));

    // Downloads has the side navigation again, and no drawer.
    expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Back on the watch page, the drawer stays closed until asked for.
    router.history.back();
    await screen.findByRole("button", { name: "Open navigation" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["a watch page", "/library/0190a3f2-7c1e-7000-8000-000000000200"],
    ["a channel page", "/library/channels/Blender"],
    ["a playlist page", "/library/playlists/0190a3f2-7c1e-7000-8000-000000000300"],
    ["a subscription's page", "/subscriptions/0190a3f2-7c1e-7000-8000-000000000400"],
  ])("leaving %s asks for nothing under the next page's name", async (_, path) => {
    const router = await renderAt(path, () =>
      screen.findByRole("button", { name: "Account menu for Alice" }),
    );
    await router.navigate({ to: "/downloads" });
    await screen.findByRole("navigation", { name: "Primary" });

    const asked = vi
      .mocked(fetch)
      .mock.calls.map(([input]) =>
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      );
    // Only the downloads page's own requests may name it.
    expect(
      asked.filter((url) => url.includes("downloads") && !url.startsWith("/api/downloads")),
    ).toEqual([]);
  });

  it("closes the watch page's drawer with its own menu button", async () => {
    await renderAt("/library/0190a3f2-7c1e-7000-8000-000000000200", () =>
      screen.findByRole("button", { name: "Open navigation" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    await userEvent.click(screen.getByRole("button", { name: "Close navigation" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open navigation" })).toHaveFocus();
  });

  it("shows the Admin section only to admins", async () => {
    await renderAt("/");
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("opens a search field under the slim top bar on phones", async () => {
    await renderAt("/settings");
    expect(screen.getAllByRole("searchbox")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Open search" }));
    expect(screen.getAllByRole("searchbox")).toHaveLength(2);
  });
});
