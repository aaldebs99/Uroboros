import type { Notice } from "@uroboros/contract";
import { Bell } from "lucide-react";
import type { ReactNode } from "react";

import type { LoggedToast } from "@/lib/toastLog";

import { NoticeRows } from "./NoticeRows";
import { PanelLink } from "./PanelLink";
import { ToastRows } from "./ToastRows";
import { WorkRows } from "./WorkRows";
import type { WorkItem } from "./work";

function Section({
  title,
  end,
  children,
}: {
  title: string;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="grid border-t border-border py-1.5 first:border-t-0">
      <div className="flex items-center justify-between gap-3 px-4 pt-1.5 pb-1">
        <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
        {end}
      </div>
      {children}
    </section>
  );
}

/**
 * The bell's panel: "In progress", "Notifications" and "Earlier in this tab", each shown only with
 * something in it, under a header whose Clear empties the notifications and the toasts.
 */
export function ActivityPanel({
  work,
  notices,
  fresh,
  toasts,
  onClear,
  onClose,
}: {
  work: readonly WorkItem[];
  notices: readonly Notice[];
  fresh: ReadonlySet<string>;
  toasts: readonly LoggedToast[];
  onClear: () => void;
  onClose: () => void;
}) {
  const empty = work.length + notices.length + toasts.length === 0;
  return (
    <div className="grid">
      <div className="flex min-h-12 items-center justify-between gap-3 py-1 pr-2 pl-4">
        <h2 className="text-base font-bold">Notifications</h2>
        {notices.length + toasts.length > 0 ? (
          <button
            type="button"
            className="h-9 rounded-full px-3.5 text-sm font-medium text-primary outline-none hover:bg-raised focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
            onClick={onClear}
          >
            Clear
          </button>
        ) : null}
      </div>
      {empty ? (
        <div className="flex flex-col items-center gap-2.5 px-6 pt-4 pb-8 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-raised text-muted-foreground">
            <Bell className="size-7" strokeWidth={1.5} aria-hidden />
          </span>
          <p className="font-bold">You&apos;re all caught up</p>
          <p className="max-w-[34ch] text-xs text-muted-foreground">
            Finished downloads, shares and new videos show up here.
          </p>
        </div>
      ) : (
        <div className="grid border-t border-border">
          {work.length > 0 ? (
            <Section
              title="In progress"
              end={
                <PanelLink
                  href="/downloads"
                  onNavigate={onClose}
                  className="rounded-full px-2 text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45"
                >
                  See all
                </PanelLink>
              }
            >
              <WorkRows work={work} onNavigate={onClose} />
            </Section>
          ) : null}
          {notices.length > 0 ? (
            <Section title="Notifications">
              <NoticeRows notices={notices} fresh={fresh} onNavigate={onClose} />
            </Section>
          ) : null}
          {toasts.length > 0 ? (
            <Section title="Earlier in this tab">
              <ToastRows toasts={toasts} onAction={onClose} />
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}
