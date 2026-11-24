import type { NewApiToken } from "@uroboros/contract";
import { useState } from "react";

import { useRevokeToken, useTokens } from "@/api/account";
import { errorText } from "@/api/client";
import { useConfirm } from "@/components/ui/confirm";
import { notify } from "@/components/ui/sonner";

import { NewTokenSecret } from "./NewTokenSecret";
import { TokenForm } from "./TokenForm";
import { TokenRow } from "./TokenRow";

/** Personal API tokens: create (secret shown once), list, revoke. */
export function Tokens() {
  const tokens = useTokens();
  const revoke = useRevokeToken();
  const [made, setMade] = useState<NewApiToken | null>(null);
  const confirm = useConfirm();
  const list = tokens.data?.tokens ?? [];
  return (
    <div className="space-y-4">
      {made === null ? null : <NewTokenSecret made={made} />}
      <TokenForm mcpEnabled={tokens.data?.mcp.enabled ?? false} onCreated={setMade} />
      {list.length > 0 ? (
        <ul aria-label="API tokens" className="divide-y divide-border border-y border-border">
          {list.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              onRevoke={() => {
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
            />
          ))}
        </ul>
      ) : null}
      {confirm.dialog}
    </div>
  );
}
