import { RouteTabs } from "@/components/ui/route-tabs";

const TABS = [
  { to: "/settings", label: "Notifications" },
  { to: "/settings/logins", label: "Logins" },
] as const;

/** Settings' views as underlined tabs, each its own route. */
export function SettingsTabs() {
  return <RouteTabs label="Settings views" tabs={TABS} />;
}
