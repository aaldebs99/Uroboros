import { CircleAlert, CircleCheck, Info, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Toaster as Sonner, type ToasterProps, toast } from "sonner";

import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

type Tone = "success" | "error" | "info";

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
};

function ToastCard({
  id,
  tone,
  title,
  detail,
  action,
  duration,
}: NotifyOptions & { id: string | number; duration: number }) {
  const { icon: Icon, className } = TONE[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="relative flex w-[min(300px,calc(100vw-2rem))] items-start gap-3 overflow-hidden rounded-[12px] border border-border bg-popover px-3.5 py-3 text-sm text-popover-foreground shadow-menu"
    >
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", className)} aria-hidden />
      <div className="grid min-w-0 flex-1 gap-0.5">
        <p className="font-medium break-words">{title}</p>
        {detail === undefined ? null : (
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        )}
      </div>
      {action === undefined ? null : (
        <button
          type="button"
          className="-my-1 h-8 shrink-0 rounded-full px-3 text-[13px] font-medium text-primary outline-none hover:bg-raised focus-visible:ring-[3px] focus-visible:ring-ring/45"
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

/** Reports what an action came to, in the design system's card with its timer line. */
function notify({ duration = 5000, ...options }: NotifyOptions) {
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

/** Themed from our own store (`useTheme`), not next-themes. Top right, unstyled cards. */
function Toaster(props: ToasterProps) {
  const { theme } = useTheme();
  return <Sonner theme={theme} position="top-right" offset={72} {...props} />;
}

export { Toaster, notify };
