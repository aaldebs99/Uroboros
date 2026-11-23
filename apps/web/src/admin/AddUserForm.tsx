import { MIN_PASSWORD_CHARS, type Role } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";
import { toast } from "sonner";

import { useCreateUser } from "@/api/account";
import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Create a local account (people without SSO: family, a TV). */
export function AddUserForm({ onDone }: { onDone: () => void }) {
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
          toast.success(`${displayName} can now sign in as ${username}.`);
          onDone();
        },
        onError: (error) => toast.error(`Could not add the user: ${errorText(error)}`),
      },
    );
  };
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    extra = {},
  ) => (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        required
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
        {...extra}
      />
    </div>
  );
  return (
    <form className="grid gap-4 rounded-md border p-4 sm:grid-cols-2" onSubmit={submit}>
      {field("new-username", "Username", username, setUsername, {
        autoComplete: "off",
        pattern: "[A-Za-z0-9._\\-]{1,64}",
      })}
      {field("new-display-name", "Display name", displayName, setDisplayName)}
      {field("new-password", "Password", password, setPassword, {
        type: "password",
        autoComplete: "new-password",
        minLength: MIN_PASSWORD_CHARS,
      })}
      <div className="grid gap-2">
        <Label htmlFor="new-role">Role</Label>
        <select
          id="new-role"
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
          value={role}
          onChange={(e) => {
            setRole(e.target.value === "admin" ? "admin" : "member");
          }}
        >
          <option value="member">Member</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" disabled={create.isPending}>
          Create user
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
