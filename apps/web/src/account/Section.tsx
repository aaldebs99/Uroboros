import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A flat section of the Account and Settings pages: a 16/700 heading with a muted line, its
 * content below, and a hairline above. No card.
 */
export function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="grid gap-1">
        <h2 className="flex items-center gap-2 text-base/[1.3] font-bold">
          <Icon className="size-4.5 text-muted-foreground" aria-hidden />
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
