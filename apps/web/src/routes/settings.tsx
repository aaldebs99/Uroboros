import { Bell } from "lucide-react";

import { Section } from "@/account/Section";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ITEMS } from "@/nav";
import { MyNotifications } from "@/settings/MyNotifications";
import { NotificationKinds } from "@/settings/NotificationKinds";

const settings = NAV_ITEMS.find((item) => item.to === "/settings");

/** Settings: for now the Notifications section; later steps add theirs beside it. */
export function SettingsPage() {
  return (
    <section className="mx-auto grid w-full max-w-3xl gap-6">
      <PageHeader title={settings?.label ?? "Settings"} description={settings?.blurb} />
      <Section
        icon={Bell}
        title="Notifications"
        description="Downloads that finish or fail, what is shared with you, and what your subscriptions find, as notifications on your phone or desktop."
      >
        <MyNotifications />
        <NotificationKinds />
      </Section>
    </section>
  );
}
