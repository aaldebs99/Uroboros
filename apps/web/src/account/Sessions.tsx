import { Monitor } from "lucide-react";
import { toast } from "sonner";

import { useSessions, useSignOutOthers, useSignOutSession } from "@/api/account";
import { errorText } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const when = (iso: string) => new Date(iso).toLocaleString();

/** The caller's signed-in browsers, with sign-out for each and for all the others. */
export function Sessions() {
  const sessions = useSessions();
  const one = useSignOutSession();
  const others = useSignOutOthers();
  const fail = (error: unknown) => toast.error(`Could not sign out: ${errorText(error)}`);
  if (sessions.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (sessions.isError)
    return <p className="text-sm text-destructive">{errorText(sessions.error)}</p>;
  return (
    <div className="space-y-4">
      <ul aria-label="Signed-in browsers" className="divide-y border-y">
        {sessions.data.map((s) => {
          const name = s.userAgent ?? "Unknown browser";
          return (
            <li key={s.id} className="flex items-center gap-3 py-3">
              <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="text-xs text-muted-foreground">Last seen {when(s.lastSeenAt)}</p>
              </div>
              {s.current ? (
                <Badge variant="secondary">This browser</Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Sign out ${name}`}
                  onClick={() => {
                    one.mutate(s.id, { onError: fail });
                  }}
                >
                  Sign out
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        disabled={others.isPending}
        onClick={() => {
          others.mutate(undefined, { onError: fail });
        }}
      >
        Sign out everywhere else
      </Button>
    </div>
  );
}
