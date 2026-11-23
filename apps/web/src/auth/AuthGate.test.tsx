import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderWithQuery, stubApi } from "@/test/render";

import { AuthGate } from "./AuthGate";

const ME = {
  id: "0190a3f2-7c1e-7000-8000-000000000001",
  displayName: "Alice",
  email: null,
  role: "member",
  method: "local",
  isBootstrap: false,
};

describe("AuthGate", () => {
  it("shows the sign-in page when nobody is signed in", async () => {
    stubApi({
      "/api/me": () =>
        Response.json({ code: "unauthorized", message: "sign in required" }, { status: 401 }),
      "/api/auth/methods": () => Response.json({ local: true, oidc: null }),
    });
    renderWithQuery(<AuthGate>{() => <p>the app</p>}</AuthGate>);
    expect(await screen.findByRole("heading", { name: "Sign in to Uroboros" })).toBeInTheDocument();
    expect(screen.queryByText("the app")).not.toBeInTheDocument();
  });

  it("renders the app for a signed-in user", async () => {
    stubApi({ "/api/me": () => Response.json(ME) });
    renderWithQuery(<AuthGate>{(me) => <p>hello {me.displayName}</p>}</AuthGate>);
    expect(await screen.findByText("hello Alice")).toBeInTheDocument();
  });
});
