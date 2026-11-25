import { Me } from "@uroboros/contract";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getJson } from "@/api/client";
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

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

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

  it("brings sign-in back on a 401 mid-session, then returns to the page the person was on", async () => {
    sessionStorage.clear();
    window.history.replaceState(null, "", "/library/abc?tab=details");
    let signedIn = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path =
          typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        if (path === "/api/me") {
          return Promise.resolve(
            signedIn
              ? Response.json(ME)
              : Response.json(
                  { code: "unauthorized", message: "sign in required" },
                  { status: 401 },
                ),
          );
        }
        if (path === "/api/auth/methods") {
          return Promise.resolve(Response.json({ local: true, oidc: null }));
        }
        if (path === "/api/auth/local/login" && init?.method === "POST") {
          signedIn = true;
          return Promise.resolve(new Response(null, { status: 204 }));
        }
        // The session expired: every other request is a 401.
        return Promise.resolve(
          Response.json({ code: "unauthorized", message: "sign in required" }, { status: 401 }),
        );
      }),
    );
    renderWithQuery(<AuthGate>{(me) => <p>hello {me.displayName}</p>}</AuthGate>);
    expect(await screen.findByText("hello Alice")).toBeInTheDocument();

    // A request mid-session finds the session gone.
    signedIn = false;
    await getJson("/api/library", Me).catch(() => undefined);
    expect(await screen.findByRole("heading", { name: "Sign in to Uroboros" })).toBeInTheDocument();
    // The person wanders off to the start page before signing in again.
    window.history.replaceState(null, "", "/");

    await userEvent.type(await screen.findByLabelText("Username"), "alice");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("hello Alice")).toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}`).toBe("/library/abc?tab=details");
  });
});
