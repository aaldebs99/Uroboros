import type { Notice } from "@uroboros/contract";
import { useMemo } from "react";

import { useActiveDownloads } from "@/api/downloads";
import { useExports } from "@/api/exports";
import { useNotices } from "@/api/notices";
import { useSubscriptions } from "@/api/subscriptions";
import { useUploadList } from "@/api/uploads";
import { useMyDownloadProgress } from "@/downloads/LiveEvents";
import { useUploadsIfAny } from "@/uploads/UploadProvider";

import { type WorkItem, workItems } from "./work";

const NO_UPLOADS = new Map();

/** What the bell shows: the notifications with the unread count, and everything in progress. */
export function useActivity(): {
  notices: readonly Notice[];
  unread: number;
  work: readonly WorkItem[];
} {
  const notices = useNotices();
  const downloads = useActiveDownloads();
  const progress = useMyDownloadProgress();
  const local = useUploadsIfAny()?.local ?? NO_UPLOADS;
  const uploads = useUploadList({ processingOnly: true });
  const copies = useExports();
  const subscriptions = useSubscriptions();
  const work = useMemo(
    () =>
      workItems({
        downloads: downloads.data ?? [],
        progress,
        local,
        uploads: uploads.data ?? [],
        copies: copies.data ?? [],
        subscriptions: subscriptions.data ?? [],
      }),
    [downloads.data, progress, local, uploads.data, copies.data, subscriptions.data],
  );
  return {
    notices: notices.data?.notices ?? [],
    unread: notices.data?.unread ?? 0,
    work,
  };
}
