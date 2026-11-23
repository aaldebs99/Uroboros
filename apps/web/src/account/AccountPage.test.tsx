import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { AuthGate } from "@/auth/AuthGate";

import { AccountPage } from "./AccountPage";

const local = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  displayName: "Alice",
  email: "alice@example.org",
  role: "member" as const,
  method: "local" as const,
  isBootstrap: false,
};
const T = "2026-11-22T10:00:00.000Z";

function api(over: Parameters<typeof fakeApi>[0] = {}) {
  return fakeApi({
    "GET /api/me/sessions": () =>
      Response.json([
        {
          id: "aaaaaaaaaaaaaaaa",
          current: true,
          userAgent: "Firefox",
          createdAt: T,
          lastSeenAt: T,
        },
        { id: "bbbbbbbbbbbbbbbb", current: false, userAgent: "Phone", createdAt: T, lastSeenAt: T },
      ]),
    "GET /api/me/tokens": () => Response.json([]),
    ...over,
  });
}

describe("AccountPage", () => {
  it("shows the profile, and no password form for an SSO user", async () => {
    api();
    renderWithQuery(<AccountPage me={{ ...local, method: "oidc" }} />);
    expect(await screen.findByText("alice@example.org")).toBeInTheDocument();
    expect(screen.getByText("Signed in with Authentik")).toBeInTheDocument();
    expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  });

  it("says the current password is wrong without signing the user out", async () => {
    api({
      "GET /api/me": () => Response.json(local),
      "POST /api/me/password": () =>
        Response.json(
          { code: "forbidden", message: "the current password is wrong" },
          { status: 403 },
        ),
    });
    renderWithQuery(<AuthGate>{(me) => <AccountPage me={me} />}</AuthGate>);
    await userEvent.type(await screen.findByLabelText("Current password"), "not my password");
    await userEvent.type(screen.getByLabelText("New password"), "a much longer password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("The current password is wrong.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to Uroboros" })).not.toBeInTheDocument();
  });

  it("changes the password, refusing a short new one", async () => {
    const calls = api({ "POST /api/me/password": () => new Response(null, { status: 204 }) });
    renderWithQuery(<AccountPage me={local} />);
    await userEvent.type(await screen.findByLabelText("Current password"), "old password!");
    await userEvent.type(screen.getByLabelText("New password"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("At least 12 characters.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("New password"));
    await userEvent.type(screen.getByLabelText("New password"), "a much longer password");
    await userEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === "/api/me/password")).toBe(true);
    });
  });

  it("lists sessions with this one marked, and signs out the others", async () => {
    const calls = api({
      "DELETE /api/me/sessions/bbbbbbbbbbbbbbbb": () => new Response(null, { status: 204 }),
      "DELETE /api/me/sessions": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<AccountPage me={local} />);
    const list = await screen.findByRole("list", { name: "Signed-in browsers" });
    expect(within(list).getByText("This browser")).toBeInTheDocument();
    await userEvent.click(within(list).getByRole("button", { name: "Sign out Phone" }));
    await userEvent.click(screen.getByRole("button", { name: "Sign out everywhere else" }));
    await waitFor(() => {
      expect(calls.filter((c) => c.method === "DELETE").map((c) => c.path)).toEqual([
        "/api/me/sessions/bbbbbbbbbbbbbbbb",
        "/api/me/sessions",
      ]);
    });
  });

  it("creates a token and shows its secret once", async () => {
    const token = {
      id: "0190a3f2-7c1e-7000-8000-0000000000aa",
      name: "cron",
      createdAt: T,
      lastUsedAt: null,
    };
    api({ "POST /api/me/tokens": () => Response.json({ token, secret: "f".repeat(64) }) });
    renderWithQuery(<AccountPage me={local} />);
    await userEvent.type(await screen.findByLabelText("Token name"), "cron");
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("f".repeat(64))).toBeInTheDocument();
    expect(screen.getByText("Copy it now: it won't be shown again.")).toBeInTheDocument();
  });

  it("revokes a token after confirming", async () => {
    vi.stubGlobal("confirm", () => true);
    const token = {
      id: "0190a3f2-7c1e-7000-8000-0000000000aa",
      name: "cron",
      createdAt: T,
      lastUsedAt: null,
    };
    const calls = api({
      "GET /api/me/tokens": () => Response.json([token]),
      "DELETE /api/me/tokens/0190a3f2-7c1e-7000-8000-0000000000aa": () =>
        new Response(null, { status: 204 }),
    });
    renderWithQuery(<AccountPage me={local} />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke cron" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path.startsWith("/api/me/tokens/"))).toBe(
        true,
      );
    });
  });
});
