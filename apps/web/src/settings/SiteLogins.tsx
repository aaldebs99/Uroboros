import { LOGIN_SITES, type LoginSite, type SiteLoginView } from "@uroboros/contract";
import { Plus } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { useRemoveSiteLogin, useSaveSiteLogin, useSiteLogins } from "@/api/siteLogins";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { ComboboxField } from "@/components/ui/combobox-field";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { notify } from "@/components/ui/sonner";

const day = (iso: string) => new Date(iso).toLocaleDateString();

/**
 * The username and password inputs, for a login yt-dlp signs in with rather than for Uroboros:
 * `new-password` and `off` keep the browser from filling in the Uroboros account.
 */
function Credentials({
  idPrefix,
  username,
  password,
  onUsername,
  onPassword,
}: {
  idPrefix: string;
  username: string;
  password: string;
  onUsername: (value: string) => void;
  onPassword: (value: string) => void;
}) {
  return (
    <>
      <Field
        id={`${idPrefix}-username`}
        label="Username or email"
        required
        maxLength={256}
        autoComplete="off"
        value={username}
        onChange={(e) => {
          onUsername(e.target.value);
        }}
      />
      <Field
        id={`${idPrefix}-password`}
        label="Password"
        type="password"
        required
        maxLength={1024}
        autoComplete="new-password"
        value={password}
        onChange={(e) => {
          onPassword(e.target.value);
        }}
      />
    </>
  );
}

/**
 * Adds a login, or replaces a saved one, in a form dialog: the site (a searchable list of
 * yt-dlp's, less those already saved; fixed when changing one), the username and the password,
 * then Save.
 */
function LoginDialog({
  login,
  choices,
  onClose,
}: {
  login: SiteLoginView | null;
  choices: readonly LoginSite[];
  onClose: () => void;
}) {
  const save = useSaveSiteLogin();
  const [site, setSite] = useState<LoginSite | "">(login?.site ?? "");
  const [username, setUsername] = useState(login?.username ?? "");
  const [password, setPassword] = useState("");
  const [siteError, setSiteError] = useState<string | null>(null);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (site === "") {
      setSiteError("Pick a site from the list.");
      return;
    }
    save.mutate(
      { site, username: username.trim(), password },
      {
        onSuccess: () => {
          notify.success(`Saved your ${site} login.`);
          onClose();
        },
        onError: (error) => {
          notify.error(`Could not save the login: ${errorText(error)}`);
        },
      },
    );
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {login === null ? "Add a login" : `Change your ${login.site} login`}
        </DialogTitle>
        <DialogDescription>
          {login === null
            ? "For a site yt-dlp signs in to. The password is kept encrypted and never shown again."
            : "Enter the password again; the old one is replaced."}
        </DialogDescription>
        <form className="grid gap-3" onSubmit={submit}>
          {login === null ? (
            <ComboboxField
              id="site-login-site"
              label="Site"
              placeholder="Type to search"
              noMatch="yt-dlp has no login for a site by that name"
              required
              options={choices}
              value={site}
              error={siteError}
              onChange={(picked) => {
                setSite(picked as LoginSite | "");
                setSiteError(null);
              }}
            />
          ) : null}
          <Credentials
            idPrefix="site-login"
            username={username}
            password={password}
            onUsername={setUsername}
            onPassword={setPassword}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="quiet">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LoginRow({
  login,
  canChange,
  onChange,
  onRemove,
}: {
  login: SiteLoginView;
  canChange: boolean;
  onChange: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {login.site}
          {login.state === "unreadable" ? <Badge tone="destructive">Enter again</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {login.username} · Updated {day(login.updatedAt)}
        </p>
      </div>
      {canChange ? (
        <Button
          variant="secondary"
          size="compact"
          aria-label={`Change the ${login.site} login`}
          onClick={onChange}
        >
          Change
        </Button>
      ) : null}
      <Button
        variant="destructive"
        size="compact"
        aria-label={`Remove the ${login.site} login`}
        onClick={onRemove}
      >
        Remove
      </Button>
    </li>
  );
}

/**
 * The caller's logins for sites yt-dlp signs in to (Settings › Logins): Add login opens a dialog
 * for the site and the credentials; a saved one can be changed (the same dialog) or removed.
 * Passwords are write-only: the server keeps them sealed and never sends them back, so a row shows
 * the username and whether the password still opens.
 */
export function SiteLogins() {
  const logins = useSiteLogins();
  const remove = useRemoveSiteLogin();
  const confirm = useConfirm();
  // The login in the dialog: "new" while adding one, a saved one while changing it.
  const [editing, setEditing] = useState<SiteLoginView | "new" | null>(null);
  if (logins.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (logins.isError) {
    return (
      <Notice tone="destructive" title="Couldn't load your logins">
        {errorText(logins.error)}
      </Notice>
    );
  }
  const { enabled, logins: saved } = logins.data;
  const taken = new Set<string>(saved.map((l) => l.site));
  const choices = LOGIN_SITES.filter((s) => !taken.has(s));
  const ask = (login: SiteLoginView) => {
    confirm.ask({
      title: `Remove your ${login.site} login?`,
      description: "Downloads from that site go back to signing in without it.",
      confirmLabel: "Remove",
      destructive: true,
      onConfirm: () => {
        remove.mutate(login.site, {
          onError: (error) => {
            notify.error(`Could not remove the login: ${errorText(error)}`);
          },
        });
      },
    });
  };
  // One shrinkable column: a long username truncates in its row instead of widening the page.
  return (
    <div className="grid grid-cols-1 gap-4">
      {enabled ? (
        <Button
          className="w-fit"
          disabled={choices.length === 0}
          onClick={() => {
            setEditing("new");
          }}
        >
          <Plus aria-hidden />
          Add login
        </Button>
      ) : (
        <Notice tone="warning" title="Saving logins is off on this server">
          It needs UROBOROS_SECRETS_KEY to keep passwords encrypted. Ask whoever runs it to set one.
        </Notice>
      )}
      {saved.length === 0 ? (
        <p className="text-sm text-muted-foreground">No saved logins yet.</p>
      ) : (
        <ul aria-label="Saved logins" className="divide-y divide-border border-y border-border">
          {saved.map((login) => (
            <LoginRow
              key={login.site}
              login={login}
              canChange={enabled}
              onChange={() => {
                setEditing(login);
              }}
              onRemove={() => {
                ask(login);
              }}
            />
          ))}
        </ul>
      )}
      {editing === null ? null : (
        <LoginDialog
          login={editing === "new" ? null : editing}
          choices={choices}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {confirm.dialog}
    </div>
  );
}
