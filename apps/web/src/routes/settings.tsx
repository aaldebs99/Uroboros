import { Bell, KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import { Section } from "@/account/Section";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ITEMS } from "@/nav";
import { MyNotifications } from "@/settings/MyNotifications";
import { NotificationKinds } from "@/settings/NotificationKinds";
import { SettingsTabs } from "@/settings/SettingsTabs";
import { SiteLogins } from "@/settings/SiteLogins";

const settings = NAV_ITEMS.find((item) => item.to === "/settings");

/**
 * Settings' frame: the (screen-reader) header and, on phones, the view tabs (the side navigation
 * lists the views from `md` up), in a column capped at the left margin (a settings column reads
 * badly stretched).
 */
function SettingsFrame({ children }: { children: ReactNode }) {
  return (
    <section className="grid w-full max-w-3xl gap-6">
      <PageHeader title={settings?.label ?? "Settings"} description={settings?.blurb} />
      <SettingsTabs />
      {/* Its own block, so the view's first section draws no rule under the tabs' hairline. */}
      <div className="grid grid-cols-1 gap-6">{children}</div>
    </section>
  );
}

/** Settings › Notifications: this device's push, and which kinds notify. */
export function SettingsPage() {
  return (
    <SettingsFrame>
      <Section
        icon={Bell}
        title="Notifications"
        description="Downloads that finish or fail, what is shared with you, and what your subscriptions find, as notifications on your phone or desktop."
      >
        <MyNotifications />
        <NotificationKinds />
      </Section>
    </SettingsFrame>
  );
}

/** Settings › Logins: the person's saved logins for sites yt-dlp signs in to. */
export function SettingsLoginsPage() {
  return (
    <SettingsFrame>
      <Section
        icon={KeyRound}
        title="Site logins"
        description="Your accounts on sites that need one (Vimeo, Twitch, SoundCloud…). Your links and subscriptions sign in with them. Passwords stay encrypted on the server and are never shown again."
      >
        <SiteLogins />
      </Section>
    </SettingsFrame>
  );
}
