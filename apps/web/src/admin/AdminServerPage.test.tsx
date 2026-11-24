import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SidebarNav } from "@/components/SidebarNav";
import { notify } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderInRouter, renderWithQuery } from "@/test/render";

import { AdminServerPage } from "./AdminServerPage";

const me = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  displayName: "Ada",
  email: null,
  role: "admin" as const,
  method: "local" as const,
  isBootstrap: false,
};

function api(patch: (body: unknown) => Response) {
  let mcpEnabled = false;
  return fakeApi({
    "GET /api/admin/settings": () => Response.json({ mcpEnabled }),
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "1", publicBaseUrl: "https://tube.example" }),
    "PATCH /api/admin/settings": (init) => {
      const body = JSON.parse(init?.body as string) as { mcpEnabled: boolean };
      const res = patch(body);
      if (res.ok) mcpEnabled = body.mcpEnabled;
      return res;
    },
  });
}

describe("AdminServerPage", () => {
  it("tells a member only admins change it", () => {
    api(() => Response.json({}));
    renderWithQuery(<AdminServerPage me={{ ...me, role: "member" }} />);
    expect(screen.getByText("Only admins can change the server's settings.")).toBeInTheDocument();
  });

  it("turns the MCP server on at once, and shows where it answers", async () => {
    const calls = api(() => Response.json({ mcpEnabled: true }));
    renderWithQuery(<AdminServerPage me={me} />);
    const toggle = await screen.findByRole("switch", { name: "MCP server" });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText("https://tube.example/api/mcp")).toBeInTheDocument();
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toBeChecked();
    });
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ mcpEnabled: true });
  });

  it("says when the change failed, and leaves the switch as it was", async () => {
    const error = vi.spyOn(notify, "error");
    api(() => Response.json({ code: "forbidden", message: "admins only" }, { status: 403 }));
    renderWithQuery(<AdminServerPage me={me} />);
    const toggle = await screen.findByRole("switch", { name: "MCP server" });
    await waitFor(() => {
      expect(toggle).toBeEnabled();
    });
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(error).toHaveBeenCalled();
    });
    expect(toggle).not.toBeChecked();
  });
});

describe("Admin › Server in the navigation", () => {
  it("is listed under Admin for admins", async () => {
    fakeApi({
      "GET /api/info": () =>
        Response.json({ name: "uroboros", version: "0.0.0", publicBaseUrl: null }),
    });
    await renderInRouter(<SidebarNav isAdmin />);
    expect(screen.getByRole("link", { name: "Server" })).toHaveAttribute("href", "/admin/server");
  });
});
