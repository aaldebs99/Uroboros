import type { DownloadProgress } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

import { applyDownloadChange, downloadKeys } from "@/api/downloads";
import { exportsKey } from "@/api/exports";
import { itemKey } from "@/api/library";
import { followLiveEvents } from "@/api/liveEvents";
import { noticesKey } from "@/api/notices";
import { previewsKey } from "@/api/previews";
import { refreshActivityHolding } from "@/api/subscriptions";
import { notify } from "@/components/ui/sonner";

import { skipsOutcome } from "./skipsOutcome";

const Progress = createContext<ReadonlyMap<string, DownloadProgress> | null>(null);

const lists = { list: downloadKeys.list(false), active: downloadKeys.active };

/**
 * The shell's one live stream (shared by this browser's tabs, `followLiveEvents`): download changes
 * go into the person's cached lists (and fetch a subscription's activity holding the download
 * again), progress into a map by fetch key, and a notice or previews
 * nudge fetches the notifications or the hover previews being made again. A SponsorBlock refetch's
 * outcome fetches its entry and the person's copies to save again, and says how it went. After a
 * gap all of them are fetched again.
 */
export function LiveEventsProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [progress, setProgress] = useState<ReadonlyMap<string, DownloadProgress>>(() => new Map());
  useEffect(
    () =>
      followLiveEvents((message) => {
        if (message.kind === "gap") {
          for (const queryKey of [lists.list, lists.active, noticesKey, previewsKey]) {
            void client.invalidateQueries({ queryKey });
          }
          return;
        }
        const event = message.event;
        switch (event.type) {
          case "progress":
            setProgress((old) => new Map(old).set(event.fetchKey, event.progress));
            return;
          case "state":
            applyDownloadChange(client, lists, { download: event.download });
            refreshActivityHolding(client, event.download.id);
            return;
          case "removed":
            applyDownloadChange(client, lists, { removed: event.id });
            return;
          case "notice":
            void client.invalidateQueries({ queryKey: noticesKey });
            return;
          case "previews":
            void client.invalidateQueries({ queryKey: previewsKey });
            return;
          case "skips":
            void client.invalidateQueries({ queryKey: itemKey(event.entryId) });
            // A copy cut from the old segments may not be current now: Save asks for a new one.
            void client.invalidateQueries({ queryKey: exportsKey });
            notify(skipsOutcome(event));
            return;
        }
      }),
    [client],
  );
  return <Progress.Provider value={progress}>{children}</Progress.Provider>;
}

/** The live progress of the person's fetches, by fetch key (inside `LiveEventsProvider`). */
export function useMyDownloadProgress(): ReadonlyMap<string, DownloadProgress> {
  const progress = useContext(Progress);
  if (progress === null) throw new Error("useMyDownloadProgress needs a LiveEventsProvider");
  return progress;
}
