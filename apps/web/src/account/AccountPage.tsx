import type { Me } from "@uroboros/contract";
import { Link } from "@tanstack/react-router";
import { ChevronRight, KeyRound, Lock, Monitor, UserRound } from "lucide-react";

import { Avatar } from "@/components/Avatar";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsRow } from "@/components/ui/settings-row";
import { ADMIN_ITEMS, NAV_ITEMS, type NavItem } from "@/nav";

import { PasswordForm } from "./PasswordForm";
import { Section } from "./Section";
import { Sessions } from "./Sessions";
import { Tokens } from "./Tokens";

const ROLE = { admin: "Admin", member: "Member" } as const satisfies Record<Me["role"], string>;

/** On phones the "You" tab lands here, so it also leads to Settings and the Admin pages. */
function PhoneLinks({ isAdmin }: { isAdmin: boolean }) {
  const items: readonly NavItem[] = [
    ...NAV_ITEMS.filter((item) => item.to === "/settings"),
    ...(isAdmin ? ADMIN_ITEMS : []),
  ];
  return (
    <ul aria-label="More" className="grid md:hidden">
      {items.map(({ to, label, icon: Icon }) => (
        <li key={to}>
          <Link
            to={to}
            className="flex h-12 items-center gap-4 rounded-[0.625rem] px-2 outline-none hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
          >
            <Icon className="size-5.5 text-muted-foreground" aria-hidden />
            <span className="flex-1">{label}</span>
            <ChevronRight className="size-4.5 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** The signed-in user's own account: profile, password, sessions and API tokens. */
export function AccountPage({ me }: { me: Me }) {
  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title="Account" description="Who you are here, and where you are signed in." />
      <div className="flex items-center gap-4">
        <Avatar name={me.displayName} className="size-16 text-2xl" />
        <div className="grid min-w-0">
          <p className="truncate text-base font-bold">{me.displayName}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[me.email, ROLE[me.role]].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
      <PhoneLinks isAdmin={me.role === "admin"} />
      <Section icon={UserRound} title="Profile">
        <div>
          <SettingsRow label="Name" description={me.displayName} />
          <SettingsRow label="Email" description={me.email ?? "—"} />
          <SettingsRow label="Role" description={ROLE[me.role]} />
          <SettingsRow
            label="Sign-in"
            description={
              me.method === "oidc" ? "Signed in with Authentik" : "Username and password"
            }
          />
        </div>
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
