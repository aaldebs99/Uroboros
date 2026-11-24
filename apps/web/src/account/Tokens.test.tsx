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

describe("Tokens", () => {
  it("makes a token for the REST API by default", async () => {
    const calls = api(false);
    await renderInRouter(<Tokens />);
    await userEvent.type(await screen.findByLabelText("Token name"), "cron");
    expect(screen.getByRole("checkbox", { name: "REST API" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText(SECRET)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "cron",
      scopes: ["api"],
      readOnly: false,
    });
  });

  it("can't offer MCP while an admin has the MCP server off, and says so", async () => {
    api(false);
    await renderInRouter(<Tokens />);
    const mcp = await screen.findByRole("checkbox", { name: "MCP" });
    expect(mcp).toBeDisabled();
    expect(mcp).toHaveAccessibleDescription("An admin has turned the MCP server off.");
  });

  it("needs at least one kind of access", async () => {
    api(true);
    await renderInRouter(<Tokens />);
    await userEvent.type(await screen.findByLabelText("Token name"), "nothing");
    await userEvent.click(screen.getByRole("checkbox", { name: "REST API" }));
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();
  });

  it("makes a read-only MCP token and shows how to connect Claude Code to it", async () => {
    const calls = api(true);
    await renderInRouter(<Tokens />);
    await userEvent.type(await screen.findByLabelText("Token name"), "claude");
    await userEvent.click(screen.getByRole("checkbox", { name: "REST API" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "MCP" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Read-only" }));
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    expect(await screen.findByText("https://tube.example/api/mcp")).toBeInTheDocument();
    expect(
      screen.getByText(
        `claude mcp add --transport http uroboros https://tube.example/api/mcp --header "Authorization: Bearer ${SECRET}"`,
      ),
    ).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({
      name: "claude",
      scopes: ["mcp"],
      readOnly: true,
    });
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
});
