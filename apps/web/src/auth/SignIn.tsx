import { Loader, LogIn } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { signInLocal, useAuthMethods } from "@/api/auth";
import { ApiError, errorText } from "@/api/client";
import { Brand } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { saveReturnTo, safePath, takeReturnTo } from "./returnTo";

/** What each `?auth_error=` the OIDC callback sends back means, in plain words. */
const AUTH_ERRORS: Record<string, (provider: string) => string> = {
  expired: () => "That sign-in took too long. Try again.",
  cancelled: () => "Sign-in was cancelled.",
  unavailable: (provider) => `${provider} isn't reachable right now. Try again in a moment.`,
  failed: () => "Sign-in didn't work. Try again.",
  disabled: () => "This account is disabled. Ask an admin.",
};

function authErrorFromUrl(provider: string): string | null {
  const code = new URLSearchParams(window.location.search).get("auth_error");
  if (code === null) return null;
  return (AUTH_ERRORS[code] ?? AUTH_ERRORS.failed)?.(provider) ?? null;
}

/** The OIDC callback's `?auth_error=`, explained. */
function AuthErrorNote({ provider }: { provider: string }) {
  const text = authErrorFromUrl(provider);
  return text === null ? null : (
    <p role="alert" className="text-sm text-destructive">
      {text}
    </p>
  );
}

function loginErrorText(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return "Wrong username or password.";
  return errorText(error);
}

function LocalForm({ onSignedIn }: { onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInLocal({ username, password });
      onSignedIn();
    } catch (err) {
      setError(loginErrorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <Input
          id="username"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? <Loader className="animate-spin" aria-hidden /> : <LogIn aria-hidden />}
        Sign in
      </Button>
    </form>
  );
}

function ProviderButton({ displayName, ready }: { displayName: string; ready: boolean }) {
  if (!ready) {
    return (
      <div className="space-y-2">
        <Button variant="outline" className="w-full" disabled>
          Continue with {displayName}
        </Button>
        <p className="text-xs text-muted-foreground">
          {displayName} isn&apos;t reachable yet. Try again in a moment.
        </p>
      </div>
    );
  }
  const returnTo = safePath(takeReturnTo());
  return (
    <Button variant="outline" className="w-full" asChild>
      <a
        href={`/api/auth/oidc/login?returnTo=${encodeURIComponent(returnTo)}`}
        onClick={() => {
          saveReturnTo(returnTo);
        }}
      >
        Continue with {displayName}
      </a>
    </Button>
  );
}

/** The sign-in page: the local form when enabled, and the OIDC provider's button. */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const methods = useAuthMethods();
  const oidc = methods.data?.oidc ?? null;
  return (
    <div className="page-glow flex min-h-dvh items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="space-y-4">
          <Brand />
          <div className="space-y-1">
            <CardTitle>
              <h1>Sign in to Uroboros</h1>
            </CardTitle>
            <CardDescription>Your downloads, library and subscriptions.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {methods.isPending ? (
            <Loader className="mx-auto animate-spin" aria-label="Loading" />
          ) : methods.isError ? (
            <p className="text-sm text-destructive">{errorText(methods.error)}</p>
          ) : (
            <>
              <AuthErrorNote provider={oidc?.displayName ?? "The sign-in provider"} />
              {methods.data.local ? <LocalForm onSignedIn={onSignedIn} /> : null}
              {methods.data.local && oidc ? (
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              {oidc ? <ProviderButton displayName={oidc.displayName} ready={oidc.ready} /> : null}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
