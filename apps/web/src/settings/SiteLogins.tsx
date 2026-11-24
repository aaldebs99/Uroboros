import { LOGIN_SITES, type LoginSite, type SiteLoginView } from "@uroboros/contract";
import { KeyRound } from "lucide-react";
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
import { Field, SelectField } from "@/components/ui/field";
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

/** Adds a login: the site from yt-dlp's list (less those already saved), then the credentials. */
function AddLogin({ saved }: { saved: ReadonlySet<string> }) {
  const save = useSaveSiteLogin();
  const [site, setSite] = useState<LoginSite | "">("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const choices = LOGIN_SITES.filter((s) => !saved.has(s));
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (site === "") return;
    save.mutate(
      { site, username: username.trim(), password },
      {
        onSuccess: () => {
          notify.success(`Saved your ${site} login.`);
          setSite("");
          setUsername("");
          setPassword("");
        },
        onError: (error) => {
          notify.error(`Could not save the login: ${errorText(error)}`);
        },
      },
    );
  };
  return (
    <form aria-label="Add a login" className="grid gap-3" onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SelectField
          id="site-login-site"
          label="Service"
          required
          value={site}
          onChange={(e) => {
            setSite(e.target.value as LoginSite | "");
          }}
        >
          <option value="" disabled>
            Choose a service
          </option>
          {choices.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
        <Credentials
          idPrefix="site-login"
          username={username}
          password={password}
          onUsername={setUsername}
          onPassword={setPassword}
        />
      </div>
      <Button type="submit" className="w-fit" disabled={save.isPending}>
        <KeyRound aria-hidden />
        {save.isPending ? "Saving…" : "Save login"}
      </Button>
    </form>
  );
}

/** Replaces a saved login's username and password, in a form dialog. */
function ChangeLogin({ login, onClose }: { login: SiteLoginView; onClose: () => void }) {
  const save = useSaveSiteLogin();
  const [username, setUsername] = useState(login.username);
  const [password, setPassword] = useState("");
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(
      { site: login.site, username: username.trim(), password },
      {
        onSuccess: () => {
          notify.success(`Saved your ${login.site} login.`);
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
        <DialogTitle>Change your {login.site} login</DialogTitle>
        <DialogDescription>Enter the password again; the old one is replaced.</DialogDescription>
        <form className="grid gap-3" onSubmit={submit}>
          <Credentials
            idPrefix="site-login-change"
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
 * The caller's logins for sites yt-dlp signs in to (Settings › Logins): add one by picking the
 * service, change or remove a saved one. Passwords are write-only: the server keeps them sealed
 * and never sends them back, so a row shows the username and whether the password still opens.
 */
export function SiteLogins() {
  const logins = useSiteLogins();
  const remove = useRemoveSiteLogin();
  const confirm = useConfirm();
  const [changing, setChanging] = useState<SiteLoginView | null>(null);
  if (logins.isPending) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (logins.isError) {
    return (
      <Notice tone="destructive" title="Couldn't load your logins">
        {errorText(logins.error)}
      </Notice>
    );
  }
  const { enabled, logins: saved } = logins.data;
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
        <AddLogin saved={new Set(saved.map((l) => l.site))} />
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
                setChanging(login);
              }}
              onRemove={() => {
                ask(login);
              }}
            />
          ))}
        </ul>
      )}
      {changing === null ? null : (
        <ChangeLogin
          login={changing}
          onClose={() => {
            setChanging(null);
          }}
        />
      )}
      {confirm.dialog}
    </div>
  );
}
