import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppRouter } from "../router";
import { stubApi } from "../test/render";

async function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("navigation", { name: "Primary" });
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
  });
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.clear();
});

describe("app shell", () => {
  it("renders the four nav links", async () => {
    await renderAt("/");

    const nav = screen.getByRole("navigation", { name: "Primary" });
    const names = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(names).toEqual(["Library", "Downloads", "Subscriptions", "Settings"]);
  });

  it("navigating to /downloads shows Coming soon", async () => {
    await renderAt("/");
    expect(screen.getByText("Coming soon")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Downloads" }));

    expect(await screen.findByRole("heading", { name: "Downloads" })).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
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

  it("toggles dark mode and remembers it in localStorage", async () => {
    await renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: /switch to (dark|light) theme/i }));

    const stored = localStorage.getItem("uroboros-theme");
    expect(["light", "dark"]).toContain(stored);
    expect(document.documentElement.classList.contains("dark")).toBe(stored === "dark");
  });

  it("shows the Admin section only to admins", async () => {
    await renderAt("/");
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });
});
