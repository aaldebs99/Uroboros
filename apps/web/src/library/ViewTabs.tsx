import { RouteTabs } from "@/components/ui/route-tabs";
import { LIBRARY_VIEWS } from "@/nav";

/**
 * The library's views as underlined tabs, on phones only: from `md` up they are rows under
 * Library in the side navigation.
 */
export function ViewTabs() {
  return <RouteTabs label="Library views" tabs={LIBRARY_VIEWS} phoneOnly />;
}
