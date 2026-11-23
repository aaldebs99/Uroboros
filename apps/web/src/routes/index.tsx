import { ComingSoon } from "@/components/ComingSoon";
import { NAV_ITEMS, type NavItem } from "@/nav";

function itemFor(to: NavItem["to"]): NavItem {
  const item = NAV_ITEMS.find((candidate) => candidate.to === to);
  if (!item) throw new Error(`no nav item for ${to}`);
  return item;
}

/** One placeholder page per section until the real features land. */
export const SubscriptionsPage = () => <ComingSoon item={itemFor("/subscriptions")} />;
export { SettingsPage } from "./settings";
