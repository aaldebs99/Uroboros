import type { Download, DownloadProgress, RequestState } from "@uroboros/contract";

import { Badge, type BadgeTone } from "@/components/ui/badge";

type Look = { label: string; tone: BadgeTone };

const REQUEST = {
  probing: { label: "Checking", tone: "primary" },
  choosing: { label: "Pick entries", tone: "warning" },
  queued: { label: "Queued", tone: "muted" },
  failed: { label: "Failed", tone: "destructive" },
} as const satisfies Record<RequestState, Look>;

const JOB = {
  queued: { label: "Queued", tone: "muted" },
  running: { label: "Starting", tone: "primary" },
  done: { label: "Done", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  cancelled: { label: "Cancelled", tone: "muted" },
} as const satisfies Record<Download["state"], Look>;

const PHASE = {
  downloading: { label: "Downloading", tone: "primary" },
  storing: { label: "Saving", tone: "primary" },
  merging: { label: "Merging", tone: "warning" },
  postprocessing: { label: "Processing", tone: "warning" },
} as const satisfies Record<DownloadProgress["phase"], Look>;

/** A download request's state as an outlined pill. */
export function RequestBadge({ state }: { state: RequestState }) {
  const { label, tone } = REQUEST[state];
  return <Badge tone={tone}>{label}</Badge>;
}

/** A download's state; while running, its phase ("Starting" until progress arrives). */
export function DownloadBadge({
  state,
  progress,
}: {
  state: Download["state"];
  progress: DownloadProgress | null;
}) {
  const { label, tone } =
    state === "running" && progress !== null ? PHASE[progress.phase] : JOB[state];
  return <Badge tone={tone}>{label}</Badge>;
}
