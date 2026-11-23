import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Centred: a large circled glyph, a title, one line and at most one action. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <span className="grid size-24 place-items-center rounded-full bg-raised text-muted-foreground">
        <Icon className="size-11" strokeWidth={1.5} aria-hidden />
      </span>
      <h2 className="text-base font-bold">{title}</h2>
      {children === undefined ? null : (
        <p className="max-w-[34ch] text-xs text-muted-foreground">{children}</p>
      )}
      {action}
    </div>
  );
}
