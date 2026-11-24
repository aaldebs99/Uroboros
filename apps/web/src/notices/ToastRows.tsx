import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";

import type { LoggedToast, ToastTone } from "@/lib/toastLog";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/subscriptions/format";

const TONE = {
  success: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleAlert, className: "text-destructive" },
  info: { icon: Info, className: "text-primary" },
} as const satisfies Record<ToastTone, { icon: LucideIcon; className: string }>;

/** This tab's toasts, newest first, each with its action still to hand. */
export function ToastRows({
  toasts,
  onAction,
}: {
  toasts: readonly LoggedToast[];
  /** After an action ran (closing the panel). */
  onAction: () => void;
}) {
  return (
    <ul className="grid">
      {toasts.map((t) => {
        const { icon: Icon, className } = TONE[t.tone];
        return (
          <li key={t.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <span className="grid size-9 shrink-0 place-items-center">
              <Icon className={cn("size-4.5", className)} aria-hidden />
            </span>
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="font-medium break-words">{t.title}</span>
              {t.detail === undefined ? null : (
                <span className="truncate text-xs text-muted-foreground">{t.detail}</span>
              )}
              <span className="text-xs text-muted-foreground">
                {relativeTime(t.at.toISOString())}
              </span>
            </span>
            {t.action === undefined ? null : (
              <button
                type="button"
                className="-my-0.5 h-8 shrink-0 rounded-full px-3 text-[0.8125rem] font-medium text-primary outline-none hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
                onClick={() => {
                  t.action?.onClick();
                  onAction();
                }}
              >
                {t.action.label}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
