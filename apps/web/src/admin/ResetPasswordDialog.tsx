import { MIN_PASSWORD_CHARS, type AdminUser } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";

import { useResetPassword } from "@/api/account";
import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

/** Sets a new password for a local account; the server signs the person out everywhere. */
export function ResetPasswordDialog({
  user,
  onClose,
}: {
  user: AdminUser | null;
  onClose: () => void;
}) {
  const reset = useResetPassword();
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setPassword("");
    setProblem(null);
    onClose();
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (user === null) return;
    if (password.length < MIN_PASSWORD_CHARS) {
      setProblem(`At least ${String(MIN_PASSWORD_CHARS)} characters.`);
      return;
    }
    reset.mutate(
      { id: user.id, password },
      {
        onSuccess: () => {
          notify.success(`${user.displayName} was signed out everywhere.`);
          close();
        },
        onError: (error) => {
          setProblem(`Could not reset the password: ${errorText(error)}`);
        },
      },
    );
  };
  return (
    <Dialog
      open={user !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent>
        <DialogTitle>Reset password</DialogTitle>
        <DialogDescription>
          A new password for {user?.displayName}. They are signed out everywhere.
        </DialogDescription>
        <form className="grid gap-3.5" onSubmit={submit}>
          <Field
            label="New password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            error={problem}
            onChange={(e) => {
              setPassword(e.target.value);
              setProblem(null);
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="quiet">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={reset.isPending}>
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
