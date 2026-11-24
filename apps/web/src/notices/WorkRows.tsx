import { Download, RefreshCw, Scissors, Upload } from "lucide-react";
import type { ReactNode } from "react";

import { DownloadBadge, ExportBadge, UploadBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatBytes, progressDetail } from "@/downloads/format";

import { PanelLink } from "./PanelLink";
import { glyphCircle, panelRow } from "./styles";
import type { WorkItem } from "./work";

/** The rows shown before "and N more". */
export const WORK_SHOWN = 5;

interface Look {
  icon: ReactNode;
  title: string;
  badge: ReactNode;
  detail: string;
  /** 0 to 100, only when real. */
  percent: number | null;
  href: string;
}

function lookOf(item: WorkItem): Look {
  switch (item.kind) {
    case "download": {
      const { download, progress } = item;
      return {
        icon: <Download aria-hidden />,
        title: download.title ?? download.url,
        badge: <DownloadBadge state={download.state} progress={progress} />,
        detail: progressDetail(progress),
        percent: progress?.percent ?? null,
        href: "/downloads",
      };
    }
    case "upload":
      return {
        icon: <Upload aria-hidden />,
        title: item.title,
        badge: <UploadBadge state={item.state} sending={item.sent !== null} />,
        detail:
          item.sent === null
            ? formatBytes(item.size)
            : `${formatBytes(item.sent)} of ${formatBytes(item.size)}`,
        percent: item.sent === null || item.size === 0 ? null : (item.sent / item.size) * 100,
        href: "/downloads",
      };
    case "copy":
      return {
        icon: <Scissors aria-hidden />,
        title: `${item.copy.title} (no sponsors)`,
        badge: <ExportBadge state={item.copy.state} />,
        detail: item.copy.encoder ?? "",
        percent:
          item.copy.state === "running" && item.copy.progress !== null
            ? item.copy.progress * 100
            : null,
        href: "/downloads",
      };
    case "check":
      return {
        icon: <RefreshCw aria-hidden />,
        title: item.title,
        badge: <Badge tone="primary">Checking</Badge>,
        detail: "",
        percent: null,
        href: `/subscriptions/${encodeURIComponent(item.id)}`,
      };
  }
}

function WorkRow({ item, onNavigate }: { item: WorkItem; onNavigate: () => void }) {
  const look = lookOf(item);
  return (
    <li>
      <PanelLink href={look.href} onNavigate={onNavigate} className={panelRow}>
        <span className={glyphCircle}>{look.icon}</span>
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="truncate font-medium">{look.title}</span>
          <span className="flex min-w-0 items-center gap-2">
            {look.badge}
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
              {look.detail}
            </span>
          </span>
          {look.percent === null ? null : (
            <ProgressBar
              label={`${look.title} progress`}
              percent={look.percent}
              className="mt-0.5"
            />
          )}
        </span>
      </PanelLink>
    </li>
  );
}

/** "In progress": the first few rows, each leading where it can be followed, then a count. */
export function WorkRows({
  work,
  onNavigate,
}: {
  work: readonly WorkItem[];
  onNavigate: () => void;
}) {
  const more = work.length - WORK_SHOWN;
  return (
    <>
      <ul className="grid">
        {work.slice(0, WORK_SHOWN).map((item) => (
          <WorkRow key={`${item.kind}:${item.id}`} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
      {more > 0 ? <p className="px-4 pb-1 text-xs text-muted-foreground">and {more} more</p> : null}
    </>
  );
}
