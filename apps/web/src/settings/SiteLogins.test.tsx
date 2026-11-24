import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { SiteLogins } from "./SiteLogins";

const T = "2026-11-23T10:00:00.000Z";
const vimeo = { site: "vimeo", username: "me@example.com", state: "ok", updatedAt: T };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SiteLogins", () => {
  it("lists saved logins, and leaves a saved site out of the dropdown", async () => {
    fakeApi({
      "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [vimeo] }),
    });
    renderWithQuery(<SiteLogins />);
    const list = await screen.findByRole("list", { name: "Saved logins" });
    expect(within(list).getByText("vimeo")).toBeInTheDocument();
    expect(within(list).getByText(/me@example\.com/)).toBeInTheDocument();
    const service = screen.getByRole("combobox", { name: "Service" });
    const options = within(service)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toContain("twitch");
    expect(options).not.toContain("vimeo");
    expect(options).not.toContain("youtube");
  });

  it("saves a login for the chosen service and clears the form", async () => {
    const calls = fakeApi({
      "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [] }),
      "PUT /api/me/site-logins/twitch": () =>
        Response.json({ site: "twitch", username: "me", state: "ok", updatedAt: T }),
    });
    renderWithQuery(<SiteLogins />);
    expect(await screen.findByText("No saved logins yet.")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Service" }), "twitch");
    await userEvent.type(screen.getByLabelText("Username or email"), " me ");
    await userEvent.type(screen.getByLabelText("Password"), 'p a"ss');
    await userEvent.click(screen.getByRole("button", { name: "Save login" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")).toMatchObject({
        path: "/api/me/site-logins/twitch",
        body: { username: "me", password: 'p a"ss' },
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Password")).toHaveValue("");
    });
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("changes a login in a dialog, asking for the password again", async () => {
    const calls = fakeApi({
      "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [vimeo] }),
      "PUT /api/me/site-logins/vimeo": () => Response.json({ ...vimeo, username: "new" }),
    });
    renderWithQuery(<SiteLogins />);
    await userEvent.click(await screen.findByRole("button", { name: "Change the vimeo login" }));
    const dialog = screen.getByRole("dialog", { name: "Change your vimeo login" });
    const username = within(dialog).getByLabelText("Username or email");
    expect(username).toHaveValue("me@example.com");
    await userEvent.clear(username);
    await userEvent.type(username, "new");
    await userEvent.type(within(dialog).getByLabelText("Password"), "fresh-pw");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
        username: "new",
        password: "fresh-pw",
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("removes a login once confirmed", async () => {
    const calls = fakeApi({
      "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [vimeo] }),
      "DELETE /api/me/site-logins/vimeo": () => new Response(null, { status: 204 }),
    });
    renderWithQuery(<SiteLogins />);
    await userEvent.click(await screen.findByRole("button", { name: "Remove the vimeo login" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE")).toBe(true);
    });
  });

  it("says saving is off without a server key, and flags a login that must be entered again", async () => {
    fakeApi({
      "GET /api/me/site-logins": () =>
        Response.json({ enabled: false, logins: [{ ...vimeo, state: "unreadable" }] }),
    });
    renderWithQuery(<SiteLogins />);
    expect(await screen.findByText("Saving logins is off on this server")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add a login" })).not.toBeInTheDocument();
    expect(screen.getByText("Enter again")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the vimeo login" })).toBeInTheDocument();
  });
});
