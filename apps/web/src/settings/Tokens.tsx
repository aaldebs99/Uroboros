import type { ApiTokenView } from "@uroboros/contract";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useRevokeToken, useTokens } from "@/api/account";
import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Notice } from "@/components/ui/notice";
import { notify } from "@/components/ui/sonner";

import { TokenDialog } from "./TokenForm";
import { TokenRow } from "./TokenRow";

/**
 * Personal API tokens (Settings › Tokens): New token opens a dialog for the options and then shows
 * the secret once; each saved token can be revoked.
 */
export function Tokens() {
  const tokens = useTokens();
  const revoke = useRevokeToken();
  const confirm = useConfirm();
  const [creating, setCreating] = useState(false);
  if (tokens.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (tokens.isError) {
    return (
      <Notice tone="destructive" title="Couldn't load your tokens">
        {errorText(tokens.error)}
      </Notice>
    );
  }
  const { mcp, tokens: list } = tokens.data;
  const ask = (t: ApiTokenView) => {
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
  };
  // One shrinkable column: a long token name truncates in its row instead of widening the page.
  return (
    <div className="grid grid-cols-1 gap-4">
      <Button
        className="w-fit"
        onClick={() => {
          setCreating(true);
        }}
      >
        <Plus aria-hidden />
        New token
      </Button>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tokens yet.</p>
      ) : (
        <ul aria-label="API tokens" className="divide-y divide-border border-y border-border">
          {list.map((t) => (
            <TokenRow
              key={t.id}
              token={t}
              onRevoke={() => {
                ask(t);
              }}
            />
          ))}
        </ul>
      )}
      {/* Mounted only while open, so each opening starts a fresh form. */}
      {creating ? (
        <TokenDialog
          mcpEnabled={mcp.enabled}
          onClose={() => {
            setCreating(false);
          }}
        />
      ) : null}
      {confirm.dialog}
    </div>
  );
}
