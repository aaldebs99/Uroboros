import { MCP_PATH, type NewApiToken } from "@uroboros/contract";
import { Copy } from "lucide-react";

import { useInfo } from "@/api/client";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/ui/sonner";

/** One value to copy, shown whole (it wraps rather than widen the page). */
function CopyLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <code className="min-w-0 flex-1 font-mono text-xs break-all">{value}</code>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            notify.success("Copied.");
          });
        }}
      >
        <Copy aria-hidden />
      </Button>
    </div>
  );
}

/** A token just made: its secret, this once, and for an MCP token how to connect a client. */
export function NewTokenSecret({ made }: { made: NewApiToken }) {
  const info = useInfo();
  const origin = info.data?.publicBaseUrl ?? window.location.origin;
  const url = `${origin.replace(/\/$/, "")}${MCP_PATH}`;
  const mcp = made.token.scopes.includes("mcp");
  return (
    <div className="grid gap-3 rounded-[0.75rem] border border-primary/40 bg-primary/10 px-3.5 py-3">
      <div className="grid gap-1">
        <p className="text-sm font-medium">Copy it now: it won&apos;t be shown again.</p>
        <CopyLine label="token" value={made.secret} />
      </div>
      {mcp ? (
        <>
          <div className="grid gap-1">
            <p className="text-sm font-medium">MCP server</p>
            <CopyLine label="MCP server address" value={url} />
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-medium">Add it to Claude Code</p>
            <CopyLine
              label="Claude Code command"
              value={`claude mcp add --transport http uroboros ${url} --header "Authorization: Bearer ${made.secret}"`}
            />
            <p className="text-xs text-muted-foreground">
              Other clients (Cursor, VS Code) take the same address with the header{" "}
              <code className="font-mono">Authorization: Bearer</code> and the token.
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
