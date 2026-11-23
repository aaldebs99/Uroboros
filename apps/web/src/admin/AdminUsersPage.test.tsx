import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { AdminUsersPage } from "./AdminUsersPage";

const ME = "0190a3f2-7c1e-7000-8000-000000000001";
const admin = {
  id: ME,
  displayName: "Ada",
  email: null,
  role: "admin" as const,
  method: "local" as const,
  isBootstrap: false,
};
const row = (over: object) => ({
  id: ME,
  displayName: "Ada",
  username: "ada",
  email: null,
  role: "admin",
  method: "local",
  disabled: false,
  revoked: false,
  isBootstrap: false,
  lastLoginAt: null,
  claimsSyncedAt: null,
  ...over,
});
const USERS = [
  row({}),
  row({
    id: "0190a3f2-7c1e-7000-8000-000000000002",
    displayName: "Boot",
    username: "admin",
    isBootstrap: true,
  }),
  row({
    id: "0190a3f2-7c1e-7000-8000-000000000003",
    displayName: "Tv",
    username: "tv",
    role: "member",
  }),
  row({
    id: "0190a3f2-7c1e-7000-8000-000000000004",
    displayName: "Sso",
    username: null,
    role: "member",
    method: "oidc",
  }),
];

const api = (over: Parameters<typeof fakeApi>[0] = {}) =>
  fakeApi({
    "GET /api/admin/users": () => Response.json(USERS),
    "GET /api/auth/methods": () =>
      Response.json({ local: true, oidc: { displayName: "Authentik", ready: true } }),
    ...over,
  });

const rowOf = async (name: string) =>
  (await screen.findByRole("cell", { name })).closest("tr") as HTMLElement;

describe("AdminUsersPage", () => {
  it("tells a member it is for admins only", () => {
    api();
    renderWithQuery(<AdminUsersPage me={{ ...admin, role: "member" }} />);
    expect(screen.getByText("Only admins can manage users.")).toBeInTheDocument();
  });

  it("lists users and only offers the actions the rules allow", async () => {
    api();
    renderWithQuery(<AdminUsersPage me={admin} />);
    const self = await rowOf("Ada");
    expect(within(self).queryByRole("button", { name: /Disable/ })).not.toBeInTheDocument();
    expect(within(self).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    const boot = await rowOf("Boot");
    expect(within(boot).queryByRole("button", { name: /Disable/ })).not.toBeInTheDocument();
    const sso = await rowOf("Sso");
    expect(within(sso).getByText("Set by Authentik groups")).toBeInTheDocument();
    expect(within(sso).queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    expect(within(sso).getByRole("button", { name: "Disable Sso" })).toBeInTheDocument();
    const tv = await rowOf("Tv");
    expect(within(tv).getByRole("button", { name: "Delete Tv" })).toBeInTheDocument();
    expect(within(tv).getByRole("button", { name: "Make Tv an admin" })).toBeInTheDocument();
  });

  it("adds a local user", async () => {
    const calls = api({ "POST /api/admin/users": () => Response.json(USERS[2]) });
    renderWithQuery(<AdminUsersPage me={admin} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add user" }));
    await userEvent.type(screen.getByLabelText("Username"), "tv");
    await userEvent.type(screen.getByLabelText("Display name"), "Living room");
    await userEvent.type(screen.getByLabelText("Password"), "a long enough password");
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "POST")?.body).toEqual({
        username: "tv",
        displayName: "Living room",
        role: "member",
        password: "a long enough password",
      });
    });
  });

  it("deletes a user after confirming, and syncs with Authentik", async () => {
    vi.stubGlobal("confirm", () => true);
    const calls = api({
      "DELETE /api/admin/users/0190a3f2-7c1e-7000-8000-000000000003": () =>
        new Response(null, { status: 204 }),
      "POST /api/admin/users/oidc-sync": () =>
        Response.json({ code: "conflict", message: "busy" }, { status: 409 }),
    });
    renderWithQuery(<AdminUsersPage me={admin} />);
    await userEvent.click(within(await rowOf("Tv")).getByRole("button", { name: "Delete Tv" }));
    await userEvent.click(screen.getByRole("button", { name: "Sync with Authentik" }));
    expect(await screen.findByText("A sync is already running.")).toBeInTheDocument();
    expect(calls.some((c) => c.method === "DELETE")).toBe(true);
  });
});
