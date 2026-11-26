import type { LibraryItem } from "@uroboros/contract";
import { useEffect } from "react";

import { refreshSkipSegments } from "@/api/library";

/**
 * Opening the person's own video refreshes its SponsorBlock segments quietly
 * (docs/automation.md#sponsorblock): once per page, for a file whose segments can be fetched. The
 * server keeps it to once an hour per file, and a failure is nothing to tell anyone.
 */
export function useQuietSkipsRefresh(entryId: string, item: LibraryItem | undefined): void {
  const refetchable = item?.sponsorSegmentsRefetchable === true;
  useEffect(() => {
    if (refetchable) refreshSkipSegments(entryId).catch(() => undefined);
  }, [entryId, refetchable]);
}
