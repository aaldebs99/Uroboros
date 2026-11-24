import { RouteTabs } from "@/components/ui/route-tabs";

const TABS = [
  { to: "/shared", label: "With me" },
  { to: "/shared/by-me", label: "By me" },
] as const;

/** Shared's two views as underlined tabs. */
export function SharedTabs() {
  return <RouteTabs label="Shared views" tabs={TABS} />;
}
