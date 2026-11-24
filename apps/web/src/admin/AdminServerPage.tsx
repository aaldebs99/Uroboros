import { MCP_PATH, type Me } from "@uroboros/contract";

import { errorText, useInfo } from "@/api/client";
import { useInstanceSettings, useSetInstanceSettings } from "@/api/instance";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";

/** Admin › Server: what is on or off for everyone, saved as each switch moves. */
export function AdminServerPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return <p className="text-muted-foreground">Only admins can change the server's settings.</p>;
  }
  return (
    <section className="grid w-full gap-6">
      <PageHeader title="Server" description="What is on or off for everyone on this server." />
      <div className="max-w-3xl">
        <McpSettings />
      </div>
    </section>
  );
}

function McpSettings() {
  const settings = useInstanceSettings();
  const save = useSetInstanceSettings();
  const info = useInfo();
  const origin = info.data?.publicBaseUrl ?? window.location.origin;
  if (settings.isError) {
    return <p className="text-sm text-destructive">{errorText(settings.error)}</p>;
  }
  const current = settings.data;
  return (
    <SettingsGroup
      title="MCP server"
      description={
        <>
          Answers at{" "}
          <code className="font-mono break-all">{`${origin.replace(/\/$/, "")}${MCP_PATH}`}</code>
        </>
      }
    >
      <SettingsRow
        label="MCP server"
        description="Lets people connect AI tools such as Claude Code, Cursor or VS Code with a token made for MCP. Turning it off stops every MCP token at once."
      >
        <Switch
          aria-label="MCP server"
          checked={current?.mcpEnabled ?? false}
          disabled={current === undefined || save.isPending}
          onCheckedChange={(on) => {
            save.mutate(
              { mcpEnabled: on },
              {
                onSuccess: (now) => {
                  notify.success(now.mcpEnabled ? "MCP server on." : "MCP server off.");
                },
                onError: (error) => {
                  notify.error(`Could not change the MCP server: ${errorText(error)}`);
                },
              },
            );
          }}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
