import type { ReactNode } from "react";

/** A group of flat settings rows under a 16/700 heading. */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-1">
      <h2 className="text-base/[1.3] font-bold">{title}</h2>
      {description === undefined ? null : (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * One flat row: the label on the left, then the muted description and the control at the right
 * edge. Below `md` they stack. `wide` gives the control the whole right column (forms, lists).
 */
export function SettingsRow({
  label,
  description,
  children,
  wide = false,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="grid gap-2 border-t border-border py-4 md:grid-cols-[200px_1fr] md:gap-5">
      <p className="font-medium">{label}</p>
      {wide ? (
        <div className="grid min-w-0 gap-3">
          {description === undefined ? null : (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
          {children}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="text-xs text-muted-foreground">{description}</div>
          {children === undefined ? null : <div className="shrink-0">{children}</div>}
        </div>
      )}
    </div>
  );
}
