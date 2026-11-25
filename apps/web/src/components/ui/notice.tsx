import { CircleAlert, CircleCheck, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type NoticeTone = "info" | "warning" | "destructive" | "success";

const TONE = {
  info: { box: "border-primary/40 bg-primary/10", icon: "text-primary", glyph: Info },
  warning: { box: "border-warning/40 bg-warning/10", icon: "text-warning", glyph: TriangleAlert },
  destructive: {
    box: "border-destructive/40 bg-destructive/10",
    icon: "text-destructive",
    glyph: CircleAlert,
  },
  success: { box: "border-success/40 bg-success/10", icon: "text-success", glyph: CircleCheck },
} as const satisfies Record<NoticeTone, { box: string; icon: string; glyph: LucideIcon }>;

/**
 * A condition the page keeps (cookies expiring, push blocked): stays until it's gone. `actions`
 * (one or two buttons, the push offer's Turn on and Not now) sit in a row under the text.
 */
export function Notice({
  tone = "info",
  title,
  children,
  actions,
  id,
  className,
}: {
  tone?: NoticeTone;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** For a control the notice explains (`aria-describedby`). */
  id?: string;
  className?: string;
}) {
  const { box, icon, glyph: Glyph } = TONE[tone];
  return (
    <div
      id={id}
      role={tone === "destructive" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-[0.75rem] border px-3.5 py-3", box, className)}
    >
      <Glyph className={cn("mt-0.5 size-4.5 shrink-0", icon)} aria-hidden />
      <div className="grid min-w-0 gap-0.5">
        <p className="font-medium">{title}</p>
        {children === undefined ? null : (
          <div className="text-xs text-muted-foreground">{children}</div>
        )}
        {actions === undefined ? null : <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
