import { Copy, KeyRound } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { useCreateToken, useRevokeToken, useTokens } from "@/api/account";
import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Field } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

const when = (iso: string | null) => (iso === null ? "never" : new Date(iso).toLocaleString());

/** Personal API tokens: create (secret shown once), list, revoke. */
export function Tokens() {
  const tokens = useTokens();
  const create = useCreateToken();
  const revoke = useRevokeToken();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const confirm = useConfirm();
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(name.trim(), {
      onSuccess: (made) => {
        setSecret(made.secret);
        setName("");
      },
      onError: (error) => {
        notify.error(`Could not create the token: ${errorText(error)}`);
      },
    });
  };
  return (
    <div className="space-y-4">
      {secret ? (
        <div className="space-y-2 rounded-[0.75rem] border border-primary/40 bg-primary/10 px-3.5 py-3">
          <p className="text-sm font-medium">Copy it now: it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{secret}</code>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Copy token"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(() => {
                  notify.success("Copied.");
                });
              }}
            >
              <Copy aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
      <form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={submit}>
        <Field
          className="flex-1"
          label="Token name"
          id="token-name"
          required
          maxLength={64}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <Button type="submit" className="sm:mt-1.5" disabled={create.isPending}>
          <KeyRound aria-hidden />
          Create token
        </Button>
      </form>
      {tokens.data && tokens.data.tokens.length > 0 ? (
        <ul aria-label="API tokens" className="divide-y divide-border border-y border-border">
          {tokens.data.tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted-foreground">Last used {when(t.lastUsedAt)}</p>
              </div>
              <Button
                variant="destructive"
                size="compact"
                aria-label={`Revoke ${t.name}`}
                onClick={() => {
                  confirm.ask({
                    title: `Revoke "${t.name}"?`,
                    description: "Anything using it stops working.",
                    confirmLabel: "Revoke",
                    destructive: true,
                    onConfirm: () => {
                      revoke.mutate(t.id, {
                        onError: (error) => {
                          notify.error(`Could not revoke: ${errorText(error)}`);
                        },
                      });
                    },
                  });
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {confirm.dialog}
    </div>
  );
}
