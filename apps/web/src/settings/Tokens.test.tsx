import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi } from "@/test/fakeApi";
import { renderInRouter } from "@/test/render";

import { Tokens } from "./Tokens";

const T = "2026-11-22T10:00:00.000Z";
const SECRET = "f".repeat(64);

const token = (over: Record<string, unknown> = {}) => ({
  id: "0190a3f2-7c1e-7000-8000-0000000000aa",
  name: "agent",
  scopes: ["api"],
  readOnly: false,
  createdAt: T,
  lastUsedAt: null,
  ...over,
});

function api(mcp: boolean, tokens: unknown[] = []) {
  return fakeApi({
    "GET /api/me/tokens": () => Response.json({ mcp: { enabled: mcp }, tokens }),
    "GET /api/info": () =>
      Response.json({ name: "uroboros", version: "1", publicBaseUrl: "https://tube.example" }),
    "POST /api/me/tokens": (init) => {
      const body = JSON.parse(init?.body as string) as { name: string; scopes: string[] };
      return Response.json({
        token: token({ name: body.name, scopes: body.scopes }),
        secret: SECRET,
      });
    },
  });
}

/** Opens New token and gives the dialog. */
async function openDialog(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole("button", { name: "New token" }));
  return screen.findByRole("dialog", { name: "New token" });
}

describe("Tokens", () => {
  it("makes a token for the REST API by default in a dialog, which then shows its secret once", async () => {
    const calls = api(false);
    await renderInRouter(<Tokens />);
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText("Token name"), "cron");
    expect(within(dialog).getByRole("checkbox", { name: "REST API" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    const made = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(made).getByText(SECRET)).toBeInTheDocument();
    expect(within(made).getByText("Copy it now: it won't be shown again.")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "cron",
      scopes: ["api"],
      readOnly: false,
    });
    await userEvent.click(within(made).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument();
  });

  it("closes on Cancel without making anything, and opens fresh next time", async () => {
    const calls = api(false);
    await renderInRouter(<Tokens />);
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText("Token name"), "half");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(within(await openDialog()).getByLabelText("Token name")).toHaveValue("");
  });

  it("can't offer MCP while an admin has the MCP server off, and says so", async () => {
    api(false);
    await renderInRouter(<Tokens />);
    const mcp = within(await openDialog()).getByRole("checkbox", { name: "MCP" });
    expect(mcp).toBeDisabled();
    expect(mcp).toHaveAccessibleDescription("An admin has turned the MCP server off.");
  });

  it("needs at least one kind of access", async () => {
    api(true);
    await renderInRouter(<Tokens />);
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText("Token name"), "nothing");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "REST API" }));
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("makes a read-only MCP token and shows how to connect Claude Code to it", async () => {
    const calls = api(true);
    await renderInRouter(<Tokens />);
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText("Token name"), "claude");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "REST API" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "MCP" }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Read-only" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    const made = await screen.findByRole("dialog", { name: "Token created" });
    expect(within(made).getByText("https://tube.example/api/mcp")).toBeInTheDocument();
    expect(
      within(made).getByText(
        `claude mcp add --transport http uroboros https://tube.example/api/mcp --header "Authorization: Bearer ${SECRET}"`,
      ),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "claude",
      scopes: ["mcp"],
      readOnly: true,
    });
  });

  it("says when there are no tokens yet", async () => {
    api(true);
    await renderInRouter(<Tokens />);
    expect(await screen.findByText("No tokens yet.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "API tokens" })).not.toBeInTheDocument();
  });

  it("lists each token with what it reaches", async () => {
    api(true, [
      token({ name: "both", scopes: ["api", "mcp"], readOnly: true }),
      token({ id: "0190a3f2-7c1e-7000-8000-0000000000bb", name: "rest", lastUsedAt: T }),
    ]);
    await renderInRouter(<Tokens />);
    const list = await screen.findByRole("list", { name: "API tokens" });
    const [both, rest] = within(list).getAllByRole("listitem");
    expect(both).toHaveTextContent("REST API · MCP · Read-only · Last used never");
    expect(rest).toHaveTextContent(/^restREST API · Last used /);
    await waitFor(() => {
      expect(within(list).getAllByRole("button", { name: /^Revoke / })).toHaveLength(2);
    });
  });

  it("revokes a token after confirming", async () => {
    const calls = fakeApi({
      "GET /api/me/tokens": () => Response.json({ mcp: { enabled: false }, tokens: [token()] }),
      "DELETE /api/me/tokens/0190a3f2-7c1e-7000-8000-0000000000aa": () =>
        new Response(null, { status: 204 }),
    });
    await renderInRouter(<Tokens />);
    await userEvent.click(await screen.findByRole("button", { name: "Revoke agent" }));
    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "DELETE" && c.path.startsWith("/api/me/tokens/"))).toBe(
        true,
      );
    });
  });
});
