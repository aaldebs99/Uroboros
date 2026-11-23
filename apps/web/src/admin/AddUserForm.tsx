import { MIN_PASSWORD_CHARS, type Role } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";

import { useCreateUser } from "@/api/account";
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
import { Field, SelectField } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

function NewUserFields({
  values,
  set,
}: {
  values: { username: string; displayName: string; password: string; role: Role };
  set: {
    username: (v: string) => void;
    displayName: (v: string) => void;
    password: (v: string) => void;
    role: (v: Role) => void;
  };
}) {
  return (
    <>
      <Field
        label="Username"
        id="new-username"
        required
        autoComplete="off"
        pattern="[A-Za-z0-9._\-]{1,64}"
        value={values.username}
        onChange={(e) => {
          set.username(e.target.value);
        }}
      />
      <Field
        label="Display name"
        id="new-display-name"
        required
        value={values.displayName}
        onChange={(e) => {
          set.displayName(e.target.value);
        }}
      />
      <Field
        label="Password"
        id="new-password"
        type="password"
        required
        autoComplete="new-password"
        minLength={MIN_PASSWORD_CHARS}
        help={`At least ${String(MIN_PASSWORD_CHARS)} characters.`}
        value={values.password}
        onChange={(e) => {
          set.password(e.target.value);
        }}
      />
      <SelectField
        label="Role"
        id="new-role"
        value={values.role}
        onChange={(e) => {
          set.role(e.target.value === "admin" ? "admin" : "member");
        }}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </SelectField>
    </>
  );
}

/** Create a local account (people without SSO: family, a TV), in a form dialog. */
export function AddUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateUser();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("member");
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(
      { username, displayName, password, role },
      {
        onSuccess: () => {
          notify.success(`${displayName} can now sign in as ${username}.`);
          setUsername("");
          setDisplayName("");
          setPassword("");
          setRole("member");
          onOpenChange(false);
        },
        onError: (error) => {
          notify.error(`Could not add the user: ${errorText(error)}`);
        },
      },
    );
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Add user</DialogTitle>
        <DialogDescription>A local account, for someone without single sign-on.</DialogDescription>
        <form className="grid gap-3.5" onSubmit={submit}>
          <NewUserFields
            values={{ username, displayName, password, role }}
            set={{
              username: setUsername,
              displayName: setDisplayName,
              password: setPassword,
              role: setRole,
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="quiet">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending}>
              Create user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
