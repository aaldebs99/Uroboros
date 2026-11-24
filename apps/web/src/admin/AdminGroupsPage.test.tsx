import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { AdminGroupsPage } from "./AdminGroupsPage";

const id = (n: number) => `0190a3f2-7c1e-7000-8000-${String(n).padStart(12, "0")}`;
const admin = {
  id: id(1),
  displayName: "Root",
  email: null,
  role: "admin" as const,
  method: "local" as const,
  isBootstrap: true,
};
const group = {
  id: id(10),
  name: "Family",
  members: 3,
  managers: ["Alice", "Bob"],
  createdAt: "2026-11-24T10:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AdminGroupsPage", () => {
  it("lists every group with its people and managers, and deletes one after asking", async () => {
    const calls = fakeApi({
      "GET /api/admin/groups": () => Response.json([group]),
      [`DELETE /api/admin/groups/${group.id}`]: () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<AdminGroupsPage me={admin} />);
    const cell = await screen.findByText("Family");
    const row = cell.closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("3")).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Alice, Bob")).toBeInTheDocument();
    await userEvent.click(
      within(row as HTMLElement).getByRole("button", { name: "Delete Family" }),
    );
    const ask = await screen.findByRole("alertdialog");
    expect(within(ask).getByText(/shared only with this group stop being shared/i)).toBeVisible();
    await userEvent.click(within(ask).getByRole("button", { name: "Delete" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });

  it("tells a member it's for admins", () => {
    renderWithQuery(<AdminGroupsPage me={{ ...admin, role: "member" }} />);
    expect(screen.getByText("Only admins can manage groups.")).toBeInTheDocument();
  });
});
