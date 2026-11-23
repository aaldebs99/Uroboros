import { MIN_PASSWORD_CHARS } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";
import { toast } from "sonner";

import { useChangePassword } from "@/api/account";
import { ApiError, errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Change a local account's password; the server signs out the other sessions. */
export function PasswordForm() {
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (next.length < MIN_PASSWORD_CHARS) {
      setProblem(`At least ${String(MIN_PASSWORD_CHARS)} characters.`);
      return;
    }
    setProblem(null);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          toast.success("Password changed. Your other browsers were signed out.");
        },
        onError: (error) => {
          setProblem(
            error instanceof ApiError && error.status === 401
              ? "The current password is wrong."
              : errorText(error),
          );
        },
      },
    );
  };
  return (
    <form className="grid max-w-sm gap-4" onSubmit={submit}>
      <div className="grid gap-2">
        <Label htmlFor="current-password">Current password</Label>
        <Input
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => {
            setCurrent(e.target.value);
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="new-password">New password</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => {
            setNext(e.target.value);
          }}
        />
      </div>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={change.isPending}>
          Change password
        </Button>
      </div>
    </form>
  );
}
