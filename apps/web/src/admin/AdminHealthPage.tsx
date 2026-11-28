import type { AdminHealth, Me } from "@uroboros/contract";

import { errorText } from "@/api/client";
import { useAdminHealth } from "@/api/health";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

import { clock, listed } from "./health/format";
import { Cooldowns, RateLimitLog } from "./health/RateLimits";
import { Replicas } from "./health/Replicas";

/** The headline: the version, the replicas answering, which one leads, and the sites limiting. */
function Tiles({ health }: { health: AdminHealth }) {
  const answering = health.replicas.filter((r) => r.status !== "not_answering");
  const versions = [...new Set(health.replicas.map((r) => r.version))].sort();
  const leader = answering.find((r) => r.leader);
  const limiting = new Set(health.cooldowns.filter((c) => c.active).map((c) => c.site));
  const tiles = [
    {
      label: "Version",
      value: health.version,
      note: versions.length > 1 ? `Replicas run ${listed(versions)}.` : null,
    },
    {
      label: "Replicas answering",
      value: `${String(answering.length)} of ${String(health.replicas.length)}`,
      note: null,
    },
    { label: "Leader", value: leader?.host ?? "None", note: null },
    { label: "Sites limiting", value: String(limiting.size), note: null },
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="grid content-start gap-1 rounded-2xl bg-card p-4 shadow-card">
          <dt className="text-sm text-muted-foreground">{t.label}</dt>
          <dd className="truncate text-2xl font-bold">{t.value}</dd>
          {t.note === null ? null : <dd className="text-xs text-warning">{t.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="grid gap-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-48 rounded-2xl" />
    </div>
  );
}

function Health() {
  const health = useAdminHealth();
  if (health.data === undefined) {
    if (health.isError) return <p className="text-destructive">{errorText(health.error)}</p>;
    return <Loading />;
  }
  // Read once per answer: the relative times move with each read, every 10 s.
  const now = health.dataUpdatedAt;
  return (
    <>
      {/* A refresh that fails (a replica still starting, say) keeps what was read last. */}
      {health.isError ? (
        <p role="status" className="text-sm text-destructive">
          Couldn&apos;t refresh: {errorText(health.error)} This is what it read at{" "}
          {clock(new Date(now).toISOString())}.
        </p>
      ) : null}
      <Tiles health={health.data} />
      <Replicas replicas={health.data.replicas} now={now} />
      <Cooldowns cooldowns={health.data.cooldowns} now={now} />
      <RateLimitLog events={health.data.events} />
    </>
  );
}

/**
 * Admin › Health (docs/health.md): the version, the replicas and how each is, the sites limiting
 * this server's requests now, and the rate limits of the past week; read again every 10 s.
 */
export function AdminHealthPage({ me }: { me: Me }) {
  if (me.role !== "admin") {
    return <p className="text-muted-foreground">Only admins can see the server&apos;s health.</p>;
  }
  return (
    <section className="grid w-full gap-6">
      <PageHeader
        title="Health"
        description="The replicas, the version, and the sites limiting requests."
      />
      <Health />
    </section>
  );
}
