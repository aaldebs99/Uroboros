import { RouteTabs } from "@/components/ui/route-tabs";
import { SETTINGS_VIEWS } from "@/nav";

/**
 * Settings' views as underlined tabs on phones only: from `md` up they are rows under Settings in
 * the side navigation, as the library's are.
 */
export function SettingsTabs() {
  return <RouteTabs label="Settings views" tabs={SETTINGS_VIEWS} phoneOnly />;
}
