import type { ReactNode } from "react";

/** The title, a muted line under it, and the page's main action at the trailing edge. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-3.5">
      <div className="grid min-w-0 gap-1">
        <h1 className="text-2xl/[1.15] font-bold">{title}</h1>
        {description === undefined ? null : <p className="text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}
