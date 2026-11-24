import { RouteTabs } from "@/components/ui/route-tabs";
import { SHARED_VIEWS } from "@/nav";

/** Shared's two views as underlined tabs on phones; from `md` up they are in the side navigation. */
export function SharedTabs() {
  return <RouteTabs label="Shared views" tabs={SHARED_VIEWS} phoneOnly />;
}
