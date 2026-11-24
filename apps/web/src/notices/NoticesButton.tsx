import { useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useState } from "react";

import { errorText } from "@/api/client";
import { exportsKey } from "@/api/exports";
import { useClearNotices, useMarkNoticesRead } from "@/api/notices";
import { subscriptionKeys } from "@/api/subscriptions";
import { uploadsKey } from "@/api/uploads";
import { Button } from "@/components/ui/button";
import { ResponsivePanel } from "@/components/ui/responsive-panel";
import { dismissToasts, notify } from "@/components/ui/sonner";
import { clearToastLog, useToastLog } from "@/lib/toastLog";

import { ActivityPanel } from "./ActivityPanel";
import { useActivity } from "./useActivity";

/** "Notifications, 2 unread, 1 in progress". */
export function bellLabel(unread: number, working: number): string {
  return [
    "Notifications",
    unread > 0 ? `${String(unread)} unread` : null,
    working > 0 ? `${String(working)} in progress` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The top bar's bell (the design system's shell reference): a count of unread notifications, a
 * ring that turns while anything is in progress, and the activity panel. Opening it dismisses the
 * toasts on screen (the panel lists them), asks again for what the live stream doesn't carry
 * (copies, uploads and checks started in another tab or on another device), and marks the
 * notifications read up to the newest one shown; those stay marked as new until it closes.
 */
export function NoticesButton() {
  const { notices, unread, work } = useActivity();
  const toasts = useToastLog();
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const client = useQueryClient();
  const markRead = useMarkNoticesRead();
  const clear = useClearNotices();
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) return;
    dismissToasts();
    for (const queryKey of [exportsKey, uploadsKey, subscriptionKeys.all]) {
      void client.invalidateQueries({ queryKey });
    }
    setFresh(new Set(notices.filter((n) => !n.read).map((n) => n.id)));
    const newest = notices[0];
    if (unread > 0 && newest !== undefined) markRead.mutate(newest.createdAt);
  };
  const working = work.length;
  return (
    <ResponsivePanel
      title="Notifications"
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <Button
          variant="ghost"
          size="icon"
          aria-label={bellLabel(unread, working)}
          className="relative rounded-full"
        >
          {working > 0 ? (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0.5 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none motion-reduce:border-primary/60"
            />
          ) : null}
          <Bell className="size-5" />
          {unread > 0 ? (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[0.6875rem] leading-none font-medium text-primary-foreground tabular-nums"
            >
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      }
    >
      <ActivityPanel
        work={work}
        notices={notices}
        fresh={fresh}
        toasts={toasts}
        onClose={() => {
          setOpen(false);
        }}
        onClear={() => {
          clearToastLog();
          if (notices.length === 0) return;
          clear.mutate(undefined, {
            onError: (err) => {
              notify.error(errorText(err), { log: false });
            },
          });
        }}
      />
    </ResponsivePanel>
  );
}
