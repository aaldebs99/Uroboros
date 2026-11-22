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
    "/api/health": () => Response.json({ status: "ok", failing: [] }),
    "/api/info": () => Response.json({ name: "uroboros", version: "0.0.0" }),
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

  it("shows the health badge in the header", async () => {
    await renderAt("/settings");

    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("toggles dark mode and remembers it in localStorage", async () => {
    await renderAt("/");

    await userEvent.click(screen.getByRole("button", { name: /switch to (dark|light) theme/i }));

    const stored = localStorage.getItem("uroboros-theme");
    expect(["light", "dark"]).toContain(stored);
    expect(document.documentElement.classList.contains("dark")).toBe(stored === "dark");
  });
});
