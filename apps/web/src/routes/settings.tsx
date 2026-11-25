import { Bell, FastForward, KeyRound, KeySquare, SlidersHorizontal, Users } from "lucide-react";
import type { ReactNode } from "react";

import { Section } from "@/account/Section";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ITEMS } from "@/nav";
import { MyNotifications } from "@/settings/MyNotifications";
import { NotificationKinds } from "@/settings/NotificationKinds";
import { FormatProfiles } from "@/settings/Profiles";
import { SettingsTabs } from "@/settings/SettingsTabs";
import { SiteLogins } from "@/settings/SiteLogins";
import { SponsorBlockSettings } from "@/settings/SponsorBlockSettings";
import { Tokens } from "@/settings/Tokens";
import { Groups } from "@/sharing/GroupsPage";

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

/** Settings › Profiles: the person's format profiles, built-in and their own, and their default. */
export function SettingsProfilesPage() {
  return (
    <SettingsFrame>
      <Section
        icon={SlidersHorizontal}
        title="Format profiles"
        description="The yt-dlp presets you download with. The built-in ones are everyone's until you change them; your changes, and the profiles you add, are yours alone. Your default is used whenever you don't pick one."
      >
        <FormatProfiles />
      </Section>
    </SettingsFrame>
  );
}

/**
 * Settings › SponsorBlock: which segments the person's player shows and skips, for videos and for
 * audio (docs/automation.md#sponsorblock).
 */
export function SettingsSponsorBlockPage() {
  return (
    <SettingsFrame>
      <Section
        icon={FastForward}
        title="SponsorBlock"
        description="Which SponsorBlock segments show on the timeline and which playback skips. Videos and audio each have their own choice; a public link you share plays by yours."
      >
        <SponsorBlockSettings />
      </Section>
    </SettingsFrame>
  );
}

/** Settings › Tokens: the person's API tokens, and New token. */
export function SettingsTokensPage() {
  return (
    <SettingsFrame>
      <Section
        icon={KeySquare}
        title="API tokens"
        description="For scripts and AI tools. A token acts as you, within the access you give it, except for account and admin changes."
      >
        <Tokens />
      </Section>
    </SettingsFrame>
  );
}

/** Settings › Groups: the groups the person is in, and New group (docs/sharing.md "Groups"). */
export function SettingsGroupsPage() {
  return (
    <SettingsFrame>
      <Section
        icon={Users}
        title="Groups"
        description="Share videos and playlists with everyone in a group at once. Anyone can make one; its managers add and remove people, and everyone in it can share with it or leave."
      >
        <Groups />
      </Section>
    </SettingsFrame>
  );
}
