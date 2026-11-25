import type { Notice, ReadyPreview } from "@uroboros/contract";
import { useMemo } from "react";

import { useActiveDownloads, useReadyPreviews } from "@/api/downloads";
import { useExports } from "@/api/exports";
import { useNotices } from "@/api/notices";
import { usePreviewWork } from "@/api/previews";
import { useSubscriptions } from "@/api/subscriptions";
import { useUploadList } from "@/api/uploads";
import { useMyDownloadProgress } from "@/downloads/LiveEvents";
import { useNow } from "@/lib/useNow";
import { useUploadsIfAny } from "@/uploads/UploadProvider";

import { type WorkItem, workItems } from "./work";

const NO_UPLOADS = new Map();

/**
 * What the bell shows: the notifications with the unread count, the pasted links waiting for a
 * pick (none past its day), and everything in progress.
 */
export function useActivity(): {
  notices: readonly Notice[];
  unread: number;
  ready: readonly ReadyPreview[];
  work: readonly WorkItem[];
} {
  const notices = useNotices();
  const waiting = useReadyPreviews();
  // Each minute: a preview past its day leaves the bell while the app sits open.
  const now = useNow(60_000);
  const downloads = useActiveDownloads();
  const progress = useMyDownloadProgress();
  const local = useUploadsIfAny()?.local ?? NO_UPLOADS;
  const uploads = useUploadList({ processingOnly: true });
  const copies = useExports();
  const subscriptions = useSubscriptions();
  const previews = usePreviewWork();
  const work = useMemo(
    () =>
      workItems({
        downloads: downloads.data ?? [],
        progress,
        local,
        uploads: uploads.data ?? [],
        copies: copies.data ?? [],
        subscriptions: subscriptions.data ?? [],
        previews: previews.data ?? null,
      }),
    [downloads.data, progress, local, uploads.data, copies.data, subscriptions.data, previews.data],
  );
  return {
    notices: notices.data?.notices ?? [],
    unread: notices.data?.unread ?? 0,
    ready: (waiting.data ?? []).filter((p) => new Date(p.expiresAt).getTime() > now),
    work,
  };
}
