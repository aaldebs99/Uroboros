import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

import { DESKTOP_QUERY, useMediaQuery } from "@/lib/media";
import { useTheme } from "@/lib/theme";
import { recordToast, type ToastTone as Tone } from "@/lib/toastLog";
import { cn } from "@/lib/utils";

const TONE = {
  success: { icon: CircleCheck, className: "text-success" },
  error: { icon: CircleAlert, className: "text-destructive" },
  info: { icon: Info, className: "text-primary" },
} as const satisfies Record<Tone, { icon: LucideIcon; className: string }>;

type NotifyOptions = {
  tone: Tone;
  title: ReactNode;
  detail?: ReactNode;
  /** At most one action ("View", "Undo"). */
  action?: { label: string; onClick: () => void };
  duration?: number;
  /** False keeps it out of the bell's "Earlier in this tab" (a passing notice, such as clearing that list failing). */
  log?: boolean;
};

function ToastCard({
  id,
  tone,
  title,
  detail,
  action,
  duration,
}: Omit<NotifyOptions, "log"> & { id: string | number; duration: number }) {
  const { icon: Icon, className } = TONE[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="relative flex w-[min(18.75rem,calc(100vw-2rem))] items-start max-md:ml-auto gap-3 overflow-hidden rounded-[0.75rem] border border-border bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-menu"
    >
      <Icon className={cn("mt-0.5 size-4.5 shrink-0", className)} aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="font-medium break-words">{title}</p>
        {detail === undefined ? null : (
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
      {action === undefined ? null : (
        <button
          type="button"
          className="-my-1 h-8 shrink-0 rounded-full px-3 text-[0.8125rem] font-medium text-primary outline-none hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
          onClick={() => {
            action.onClick();
            toast.dismiss(id);
          }}
        >
          {action.label}
        </button>
      )}
      <span
        aria-hidden
        className="toast-timer absolute inset-x-0 bottom-0 h-0.5 origin-left bg-primary"
        style={{ animationDuration: `${String(duration)}ms` }}
      />
    </div>
  );
}

/**
 * Reports what an action came to, in the design system's card with its timer line, and keeps it in
 * this tab's toast log for the bell.
 */
function notify({ duration = 5000, log = true, ...options }: NotifyOptions) {
  if (log) recordToast(options);
  return toast.custom((id) => <ToastCard id={id} duration={duration} {...options} />, {
    duration,
  });
}

type Shortcut = (title: ReactNode, options?: Omit<NotifyOptions, "tone" | "title">) => void;
const shortcut =
  (tone: Tone): Shortcut =>
  (title, options) => {
    notify({ tone, title, ...options });
  };
notify.success = shortcut("success");
notify.error = shortcut("error");
notify.info = shortcut("info");

/** Dismisses every toast on screen (they stay in the bell's toast log). */
function dismissToasts(): void {
  toast.dismiss();
}

/** The phones' bottom tabs (`TabBar`), which toasts sit just above. */
const TAB_BAR = "3.625rem + env(safe-area-inset-bottom)";

/**
 * Themed from our own store (`useTheme`), not next-themes; unstyled cards. From `md` up they come
 * in at the top right, under the top bar. On phones they come in at the bottom right, just above
 * the bottom tabs when the page has them (`aboveTabBar`), and Sonner's own phone layout (below
 * 600px) gets the same offsets.
 */
function Toaster({ aboveTabBar = false, ...props }: ToasterProps & { aboveTabBar?: boolean }) {
  const { theme } = useTheme();
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) return <Sonner theme={theme} position="top-right" offset="4.5rem" {...props} />;
  const offset = {
    right: "1rem",
    left: "1rem",
    bottom: aboveTabBar ? `calc(${TAB_BAR} + 0.75rem)` : "1rem",
  };
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      offset={offset}
      mobileOffset={offset}
      {...props}
    />
  );
}

export { Toaster, dismissToasts, notify };
