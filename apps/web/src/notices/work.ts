import type {
  Download,
  DownloadProgress,
  Export,
  Subscription,
  Upload,
  UploadState,
} from "@uroboros/contract";

import type { LocalUpload } from "@/uploads/UploadProvider";

/** One thing being worked on, for the bell's "In progress". */
export type WorkItem =
  | { kind: "download"; id: string; download: Download; progress: DownloadProgress | null }
  | {
      kind: "upload";
      id: string;
      title: string;
      state: UploadState;
      /** This tab is sending it: bytes so far, of `size`. */
      sent: number | null;
      size: number;
    }
  | { kind: "copy"; id: string; copy: Export }
  | { kind: "check"; id: string; title: string };

/** This tab's uploads, as the server's states: sending or paused is still `receiving`. */
function localUploads(local: ReadonlyMap<string, LocalUpload>): WorkItem[] {
  const items: WorkItem[] = [];
  for (const u of local.values()) {
    if (u.state === "done" || u.state === "failed") continue;
    items.push({
      kind: "upload",
      id: u.id,
      title: u.title,
      state: u.state === "processing" ? "processing" : "receiving",
      sent: u.state === "sending" ? u.sent : null,
      size: u.size,
    });
  }
  return items;
}

/**
 * Everything in progress: the person's queued and running downloads (with live progress), uploads
 * (this tab's, and any the server is processing), copies being made, and subscriptions being
 * checked.
 */
export function workItems(sources: {
  downloads: readonly Download[];
  progress: ReadonlyMap<string, DownloadProgress>;
  local: ReadonlyMap<string, LocalUpload>;
  uploads: readonly Upload[];
  copies: readonly Export[];
  subscriptions: readonly Subscription[];
}): WorkItem[] {
  const downloads: WorkItem[] = sources.downloads
    .filter((d) => d.state === "queued" || d.state === "running")
    .map((d) => ({
      kind: "download",
      id: d.id,
      download: d,
      progress: d.state === "running" ? (sources.progress.get(d.fetchKey) ?? d.progress) : null,
    }));
  const mine = localUploads(sources.local);
  const processing: WorkItem[] = sources.uploads
    .filter((u) => u.state === "processing" && !sources.local.has(u.id))
    .map((u) => ({
      kind: "upload",
      id: u.id,
      title: u.title,
      state: u.state,
      sent: null,
      size: u.size,
    }));
  const copies: WorkItem[] = sources.copies
    .filter((c) => c.state === "queued" || c.state === "running")
    .map((c) => ({ kind: "copy", id: c.id, copy: c }));
  const checks: WorkItem[] = sources.subscriptions
    .filter((s) => s.checking)
    .map((s) => ({ kind: "check", id: s.id, title: s.title ?? "A subscription" }));
  return [...downloads, ...mine, ...processing, ...copies, ...checks];
}
