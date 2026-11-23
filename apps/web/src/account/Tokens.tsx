import { Copy, KeyRound } from "lucide-react";
import { useState, type SubmitEvent } from "react";
import { toast } from "sonner";

import { useCreateToken, useRevokeToken, useTokens } from "@/api/account";
import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const when = (iso: string | null) => (iso === null ? "never" : new Date(iso).toLocaleString());

/** Personal API tokens: create (secret shown once), list, revoke. */
export function Tokens() {
  const tokens = useTokens();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: (made) => {
        setSecret(made.secret);
        setName("");
      },
      onError: (error) => toast.error(`Could not create the token: ${errorText(error)}`),
    });
  };
  return (
    <div className="space-y-4">
      {secret ? (
        <div className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-medium">Copy it now: it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{secret}</code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy token"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(() => toast.success("Copied."));
              }}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
      <form className="flex items-end gap-2" onSubmit={submit}>
        <div className="grid flex-1 gap-2">
          <Label htmlFor="token-name">Token name</Label>
          <Input
            id="token-name"
            required
            maxLength={64}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </div>
        <Button type="submit" disabled={create.isPending}>
          <KeyRound aria-hidden />
          Create token
        </Button>
      </form>
      {tokens.data && tokens.data.length > 0 ? (
        <ul aria-label="API tokens" className="divide-y border-y">
          {tokens.data.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">Last used {when(t.lastUsedAt)}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Revoke ${t.name}`}
                onClick={() => {
                  if (window.confirm(`Revoke "${t.name}"? Anything using it stops working.`)) {
                    revoke.mutate(t.id, {
                      onError: (error) => toast.error(`Could not revoke: ${errorText(error)}`),
                    });
                  }
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
