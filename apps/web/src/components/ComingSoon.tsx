import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { NavItem } from "@/nav";

/** A section that isn't built yet: its header and an empty state saying so. */
export function ComingSoon({ item }: { item: NavItem }) {
  return (
    <section className="mx-auto grid w-full max-w-5xl gap-6">
      <PageHeader title={item.label} description={item.blurb} />
      <EmptyState icon={item.icon} title="Coming soon">
        This part of Uroboros isn&apos;t built yet.
      </EmptyState>
    </section>
  );
}
