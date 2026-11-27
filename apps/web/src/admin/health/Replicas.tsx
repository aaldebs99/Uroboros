import type { Replica } from "@uroboros/contract";

import { Badge } from "@/components/ui/badge";
import { relativeTime } from "@/subscriptions/format";

import { At } from "./At";
import { CHECK_NAME, REPLICA_STATUS, cell, head, num, row } from "./format";

function StatusBadge({ replica }: { replica: Replica }) {
  const { label, tone } = REPLICA_STATUS[replica.status];
  const failing = replica.failing.map((c) => CHECK_NAME[c]).join(", ");
  return <Badge tone={tone}>{failing === "" ? label : `${label}: ${failing}`}</Badge>;
}

function ReplicaRow({ replica, now }: { replica: Replica; now: number }) {
  return (
    <tr className={row}>
      <td className={`${cell} font-medium`}>
        {replica.host}
        {replica.current ? (
          <span className="ml-2 font-normal text-muted-foreground">This replica</span>
        ) : null}
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Version: </span>
        {replica.version}
      </td>
      <td className={cell}>
        <StatusBadge replica={replica} />
      </td>
      <td className={cell}>{replica.leader ? "Leader" : null}</td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Started: </span>
        <At iso={replica.startedAt}>{relativeTime(replica.startedAt, now)}</At>
      </td>
      <td className={num}>
        <span className="text-muted-foreground md:sr-only">Jobs running: </span>
        {replica.runningJobs.toLocaleString()}
      </td>
      <td className={cell}>
        <span className="text-muted-foreground md:sr-only">Last seen: </span>
        <At iso={replica.seenAt}>{relativeTime(replica.seenAt, now)}</At>
      </td>
    </tr>
  );
}

/**
 * Every replica that checked in within the hour, the one answering first: its state (ready,
 * degraded and why, or not answering after 45 s quiet), version, the leader, and what it runs.
 */
export function Replicas({ replicas, now }: { replicas: readonly Replica[]; now: number }) {
  return (
    <section aria-labelledby="health-replicas" className="grid gap-3">
      <h2 id="health-replicas" className="text-base font-bold">
        Replicas
      </h2>
      {replicas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No replica has checked in yet. Replicas of a release before this one don&apos;t.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table aria-labelledby="health-replicas" className="w-full text-left text-sm">
            <thead className="max-md:sr-only">
              <tr>
                <th className={head}>Host</th>
                <th className={head}>Version</th>
                <th className={head}>Status</th>
                <th className={head}>Role</th>
                <th className={head}>Started</th>
                <th className={`${head} text-right`}>Jobs running</th>
                <th className={head}>Last seen</th>
              </tr>
            </thead>
            <tbody className="max-md:grid">
              {replicas.map((r) => (
                <ReplicaRow key={r.id} replica={r} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
