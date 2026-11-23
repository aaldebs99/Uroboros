import type {
  Download,
  DownloadProgress,
  RequestState,
  Subscription,
  SubscriptionItemOutcome,
} from "@uroboros/contract";

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

const OUTCOME = {
  queued: { label: "Queued", tone: "success" },
  filtered: { label: "Filtered", tone: "muted" },
  existing: { label: "Skipped", tone: "muted" },
  waiting: { label: "Waiting", tone: "warning" },
} as const satisfies Record<SubscriptionItemOutcome, Look>;

/** What became of a video a subscription saw. */
export function ItemOutcomeBadge({ outcome }: { outcome: SubscriptionItemOutcome }) {
  const { label, tone } = OUTCOME[outcome];
  return <Badge tone={tone}>{label}</Badge>;
}

/** A subscription's state when it is not plainly active: checking, paused or failing. */
export function SubscriptionBadge({
  sub,
}: {
  sub: Pick<Subscription, "checking" | "enabled" | "failures">;
}) {
  if (sub.checking) return <Badge tone="primary">Checking</Badge>;
  if (!sub.enabled) return <Badge tone="muted">Paused</Badge>;
  if (sub.failures > 0) return <Badge tone="destructive">Failing</Badge>;
  return null;
}
