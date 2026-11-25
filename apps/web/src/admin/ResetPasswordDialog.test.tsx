import type { AdminUser } from "@uroboros/contract";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Toaster } from "@/components/ui/sonner";
import { fakeApi } from "@/test/fakeApi";
import { renderWithQuery } from "@/test/render";

import { ResetPasswordDialog } from "./ResetPasswordDialog";

const user: AdminUser = {
  id: "0190a3f2-7c1e-7000-8000-0000000000b1",
  displayName: "Bob",
  username: "bob",
  email: null,
  role: "member",
  method: "local",
  disabled: false,
  revoked: false,
  isBootstrap: false,
  lastLoginAt: null,
  claimsSyncedAt: null,
};
const path = `/api/admin/users/${user.id}/password`;

function show(onClose = vi.fn()) {
  renderWithQuery(
    <>
      <ResetPasswordDialog user={user} onClose={onClose} />
      <Toaster />
    </>,
  );
  return onClose;
}

describe("ResetPasswordDialog", () => {
  it("sets the new password, says who was signed out, and closes", async () => {
    const calls = fakeApi({ [`POST ${path}`]: () => new Response(null, { status: 204 }) });
    const onClose = show();
    await userEvent.type(screen.getByLabelText("New password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    expect(calls).toEqual([
      expect.objectContaining({
        method: "POST",
        path,
        body: { password: "correct horse battery" },
      }),
    ]);
    expect(await screen.findByText("Bob was signed out everywhere.")).toBeInTheDocument();
  });

  it("refuses a short password before asking the server", async () => {
    const calls = fakeApi({});
    const onClose = show();
    await userEvent.type(screen.getByLabelText("New password"), "too short");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText("At least 12 characters.")).toBeInTheDocument();
    expect(calls).toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps the dialog open with the server's reason when the reset fails", async () => {
    fakeApi({
      [`POST ${path}`]: () =>
        Response.json(
          { code: "conflict", message: "this account signs in with SSO" },
          { status: 409 },
        ),
    });
    const onClose = show();
    await userEvent.type(screen.getByLabelText("New password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByText(/Could not reset the password:/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Reset password" })).toBeInTheDocument();
  });
});
