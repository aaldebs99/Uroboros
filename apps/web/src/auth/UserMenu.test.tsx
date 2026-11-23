import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { UserMenu } from "./UserMenu";

const me = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  displayName: "Alice",
  email: null,
  role: "admin" as const,
  method: "oidc" as const,
  isBootstrap: false,
};

describe("UserMenu", () => {
  it("picks a size in Size, which sets the UI scale and is remembered", async () => {
    await renderInRouter(<UserMenu me={me} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu for Alice" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Size: 100%" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "125%" }));

    expect(localStorage.getItem("uroboros-ui-scale")).toBe("1.25");
    expect(document.documentElement.style.getPropertyValue("--ui-scale")).toBe("1.25");
    localStorage.clear();
    document.documentElement.style.removeProperty("--ui-scale");
  });

  it("shows the name and role, and sends an SSO user to the provider on sign-out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ endSessionUrl: "https://sso.example/end" }))),
    );
    const navigate = vi.fn();
    await renderInRouter(<UserMenu me={me} navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu for Alice" }));
    expect(await screen.findByText("Admin")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("https://sso.example/end");
    });
  });

  it("returns a local user to the start page on sign-out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ endSessionUrl: null }))),
    );
    const navigate = vi.fn();
    await renderInRouter(
      <UserMenu me={{ ...me, method: "local", role: "member" }} navigate={navigate} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Account menu for Alice" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/");
    });
  });

  it("drops this browser's push device before signing out, so the next person gets no pushes", async () => {
    const id = "0190a3f2-7c1e-7000-8000-0000000000aa";
    localStorage.setItem(
      "uroboros.pushDevice",
      JSON.stringify({ id, endpoint: "https://push.example/x" }),
    );
    const calls = fakeApi({
      [`DELETE /api/me/push/devices/${id}`]: () => new Response(null, { status: 204 }),
      "POST /api/auth/logout": () => Response.json({ endSessionUrl: null }),
    });
    const navigate = vi.fn();
    await renderInRouter(<UserMenu me={{ ...me, method: "local" }} navigate={navigate} />);
    await userEvent.click(screen.getByRole("button", { name: "Account menu for Alice" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith("/");
    });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /api/me/push/devices/${id}`,
      "POST /api/auth/logout",
    ]);
    expect(localStorage.getItem("uroboros.pushDevice")).toBeNull();
  });
});
