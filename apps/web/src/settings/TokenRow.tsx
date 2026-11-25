import type { ApiTokenView } from "@uroboros/contract";

import { Button } from "@/components/ui/button";

import { SCOPE_LABELS } from "./tokenLabels";

const when = (iso: string | null) => (iso === null ? "never" : new Date(iso).toLocaleString());

/** What a token reaches and when it was last used, as one muted line. */
export function tokenMeta(t: ApiTokenView): string {
  return [
    ...t.scopes.map((s) => SCOPE_LABELS[s]),
    ...(t.readOnly ? ["Read-only"] : []),
    `Last used ${when(t.lastUsedAt)}`,
  ].join(" · ");
}

export function TokenRow({ token, onRevoke }: { token: ApiTokenView; onRevoke: () => void }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{token.name}</p>
        <p className="text-xs text-muted-foreground">{tokenMeta(token)}</p>
      </div>
      <Button
        variant="destructive"
        size="compact"
        aria-label={`Revoke ${token.name}`}
        onClick={onRevoke}
      >
        Revoke
      </Button>
    </li>
  );
}
