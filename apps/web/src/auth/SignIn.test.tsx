import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithQuery } from "@/test/render";

import { SignIn } from "./SignIn";

function stub(methods: object, login: () => Response = () => new Response(null, { status: 204 })) {
  const posted: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === "/api/auth/methods") return Promise.resolve(Response.json(methods));
      if (url === "/api/auth/local/login") {
        posted.push(JSON.parse(init?.body as string));
        return Promise.resolve(login());
      }
      return Promise.reject(new TypeError("fetch failed"));
    }),
  );
  return posted;
}

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SignIn", () => {
  it("shows only the provider button when local sign-in is off", async () => {
    stub({ local: false, oidc: { displayName: "Authentik", ready: true } });
    renderWithQuery(<SignIn onSignedIn={() => undefined} />);
    const button = await screen.findByRole("link", { name: "Continue with Authentik" });
    expect(button).toHaveAttribute("href", "/api/auth/oidc/login?returnTo=%2F");
    expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  });

  it("disables the provider button until it is reachable", async () => {
    stub({ local: true, oidc: { displayName: "Authentik", ready: false } });
    renderWithQuery(<SignIn onSignedIn={() => undefined} />);
    expect(
      await screen.findByText("Authentik isn't reachable yet. Try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Authentik" })).toBeDisabled();
  });

  it("signs in with a username and password", async () => {
    const posted = stub({ local: true, oidc: null });
    const onSignedIn = vi.fn();
    renderWithQuery(<SignIn onSignedIn={onSignedIn} />);
    await userEvent.type(await screen.findByLabelText("Username"), "alice");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledOnce();
    });
    expect(posted).toEqual([{ username: "alice", password: "correct horse battery" }]);
  });

  it("says when the password is wrong", async () => {
    stub({ local: true, oidc: null }, () =>
      Response.json(
        { code: "unauthorized", message: "wrong username or password" },
        { status: 401 },
      ),
    );
    renderWithQuery(<SignIn onSignedIn={() => undefined} />);
    await userEvent.type(await screen.findByLabelText("Username"), "alice");
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong username or password.");
  });

  it.each([
    ["expired", "That sign-in took too long. Try again."],
    ["cancelled", "Sign-in was cancelled."],
    ["unavailable", "Authentik isn't reachable right now. Try again in a moment."],
    ["failed", "Sign-in didn't work. Try again."],
    ["disabled", "This account is disabled. Ask an admin."],
    ["unregistered", "There's no Uroboros account for you yet. Ask an admin to let you in."],
  ])("explains auth_error=%s", async (code, text) => {
    window.history.replaceState(null, "", `/?auth_error=${code}`);
    stub({ local: true, oidc: { displayName: "Authentik", ready: true } });
    renderWithQuery(<SignIn onSignedIn={() => undefined} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
});
