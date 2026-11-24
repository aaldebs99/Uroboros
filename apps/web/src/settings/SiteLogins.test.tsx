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
    await userEvent.click(screen.getByRole("button", { name: "Add login" }));
    const dialog = screen.getByRole("dialog", { name: "Add a login" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Site" }));
    const options = within(within(dialog).getByRole("listbox", { name: "Site" }))
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(options).toContain("twitch");
    expect(options).not.toContain("vimeo");
    expect(options).not.toContain("youtube");
  });

  it("adds a login in a dialog: a searched-for site, the username and the password, then Save", async () => {
    const calls = fakeApi({
      "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [] }),
      "PUT /api/me/site-logins/twitch": () =>
        Response.json({ site: "twitch", username: "me", state: "ok", updatedAt: T }),
    });
    renderWithQuery(<SiteLogins />);
    expect(await screen.findByText("No saved logins yet.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Site" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add login" }));
    const dialog = screen.getByRole("dialog", { name: "Add a login" });
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Site" }), "twi");
    expect(
      within(within(dialog).getByRole("listbox", { name: "Site" }))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["twitch"]);
    await userEvent.keyboard("{Enter}");
    await userEvent.type(within(dialog).getByLabelText("Username or email"), " me ");
    const password = within(dialog).getByLabelText("Password");
    expect(password).toHaveAttribute("autocomplete", "new-password");
    await userEvent.type(password, 'p a"ss');
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(calls.find((c) => c.method === "PUT")).toMatchObject({
        path: "/api/me/site-logins/twitch",
        body: { username: "me", password: 'p a"ss' },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("changes a login in a dialog, asking for the password again", async () => {
    const calls = fakeApi({
      "GET /api/me/site-logins": () => Response.json({ enabled: true, logins: [vimeo] }),
      "PUT /api/me/site-logins/vimeo": () => Response.json({ ...vimeo, username: "new" }),
    });
    renderWithQuery(<SiteLogins />);
    await userEvent.click(await screen.findByRole("button", { name: "Change the vimeo login" }));
    const dialog = screen.getByRole("dialog", { name: "Change your vimeo login" });
    expect(within(dialog).queryByRole("combobox", { name: "Site" })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Add login" })).not.toBeInTheDocument();
    expect(screen.getByText("Enter again")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the vimeo login" })).toBeInTheDocument();
  });
});
