import type { NewApiToken, TokenScope } from "@uroboros/contract";
import { KeyRound } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { useCreateToken } from "@/api/account";
import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/field";
import { notify } from "@/components/ui/sonner";

import { SCOPE_LABELS } from "./tokenLabels";

const SCOPE_HELP: Record<TokenScope, string> = {
  api: "Scripts and tools calling the REST API under /api.",
  mcp: "AI tools such as Claude Code, Cursor or VS Code, through the MCP server.",
};
const MCP_OFF = "An admin has turned the MCP server off.";

function CheckRow({
  id,
  label,
  help,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="flex min-h-11 items-start gap-3 py-1.5 md:min-h-8">
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-help`}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      <div className="grid min-w-0 gap-0.5">
        <label htmlFor={id} className={disabled ? "opacity-45" : undefined}>
          {label}
        </label>
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          {help}
        </p>
      </div>
    </div>
  );
}

/** Makes a token: its name, what it reaches (at least one), and whether it only reads. */
export function TokenForm({
  mcpEnabled,
  onCreated,
}: {
  mcpEnabled: boolean;
  onCreated: (made: NewApiToken) => void;
}) {
  const create = useCreateToken();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ReadonlySet<TokenScope>>(new Set(["api"]));
  const [readOnly, setReadOnly] = useState(false);
  const wanted = [...scopes].filter((s) => s !== "mcp" || mcpEnabled).sort();
  const toggle = (scope: TokenScope, on: boolean) => {
    const next = new Set(scopes);
    if (on) next.add(scope);
    else next.delete(scope);
    setScopes(next);
  };
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.mutate(
      { name: name.trim(), scopes: wanted, readOnly },
      {
        onSuccess: (made) => {
          onCreated(made);
          setName("");
        },
        onError: (error) => {
          notify.error(`Could not create the token: ${errorText(error)}`);
        },
      },
    );
  };
  return (
    <form className="grid max-w-xl gap-3" onSubmit={submit}>
      <Field
        label="Token name"
        id="token-name"
        required
        maxLength={64}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <fieldset className="grid">
        <legend className="mb-1 font-medium">Access</legend>
        <CheckRow
          id="token-scope-api"
          label={SCOPE_LABELS.api}
          help={SCOPE_HELP.api}
          checked={scopes.has("api")}
          onChange={(on) => {
            toggle("api", on);
          }}
        />
        <CheckRow
          id="token-scope-mcp"
          label={SCOPE_LABELS.mcp}
          help={mcpEnabled ? SCOPE_HELP.mcp : MCP_OFF}
          checked={mcpEnabled && scopes.has("mcp")}
          disabled={!mcpEnabled}
          onChange={(on) => {
            toggle("mcp", on);
          }}
        />
      </fieldset>
      <CheckRow
        id="token-read-only"
        label="Read-only"
        help="Can look, but can't change anything."
        checked={readOnly}
        onChange={setReadOnly}
      />
      <div>
        <Button type="submit" disabled={create.isPending || wanted.length === 0}>
          <KeyRound aria-hidden />
          {create.isPending ? "Creating…" : "Create token"}
        </Button>
      </div>
    </form>
  );
}
