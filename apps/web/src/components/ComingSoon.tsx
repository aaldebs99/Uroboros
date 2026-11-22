import { Card, CardContent } from "@/components/ui/card";
import type { NavItem } from "@/nav";

export function ComingSoon({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <section className="mx-auto w-full max-w-3xl">
      <h1 className="text-3xl font-semibold">{item.label}</h1>
      <p className="mt-1 text-muted-foreground">{item.blurb}</p>
      <Card className="mt-8 border-dashed bg-card/60">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Icon className="size-7" />
          </span>
          <p className="font-display text-xl font-medium">Coming soon</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            This part of Uroboros is not built yet. The shell is ready for it.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}
