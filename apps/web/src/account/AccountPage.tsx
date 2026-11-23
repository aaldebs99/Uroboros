import type { Me } from "@uroboros/contract";
import { KeyRound, Lock, Monitor, UserRound } from "lucide-react";

import { PasswordForm } from "./PasswordForm";
import { Section } from "./Section";
import { Sessions } from "./Sessions";
import { Tokens } from "./Tokens";

const ROLE = { admin: "Admin", member: "Member" } as const satisfies Record<Me["role"], string>;

/** The signed-in user's own account: profile, password, sessions and API tokens. */
export function AccountPage({ me }: { me: Me }) {
  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <div>
        <h1 className="text-3xl font-semibold">Account</h1>
        <p className="mt-1 text-muted-foreground">Who you are here, and where you are signed in.</p>
      </div>
      <Section icon={UserRound} title="Profile">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Name</dt>
          <dd>{me.displayName}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd>{me.email ?? "—"}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{ROLE[me.role]}</dd>
          <dt className="text-muted-foreground">Sign-in</dt>
          <dd>{me.method === "oidc" ? "Signed in with Authentik" : "Username and password"}</dd>
        </dl>
      </Section>
      {me.method === "local" ? (
        <Section
          icon={Lock}
          title="Password"
          description="Changing it signs out your other browsers."
        >
          <PasswordForm />
        </Section>
      ) : null}
      <Section icon={Monitor} title="Sessions" description="Browsers signed in to your account.">
        <Sessions />
      </Section>
      <Section
        icon={KeyRound}
        title="API tokens"
        description="For scripts and tools. A token acts as you, except for account and admin changes."
      >
        <Tokens />
      </Section>
    </section>
  );
}
