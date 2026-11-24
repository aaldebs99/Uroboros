import type { Kysely } from "kysely";
import type { Database } from "../src/db/schema.ts";
import type { QueueName } from "../src/jobs/queues.ts";

export interface LiveJob {
  name: string;
  key: string | null;
  data: unknown;
  state: "queued" | "running";
  attempts: number;
  stalls: number;
  runAt: Date;
}

/** The jobs waiting or running on `queue`, oldest first. */
export async function liveJobs(db: Kysely<Database>, queue: QueueName): Promise<LiveJob[]> {
  const rows = await db
    .selectFrom("jobs")
    .select(["name", "key", "data", "state", "attempts", "stalls", "run_at"])
    .where("queue", "=", queue)
    .orderBy("id")
    .execute();
  return rows.map((r) => ({
    name: r.name,
    key: r.key,
    data: r.data,
    state: r.state,
    attempts: r.attempts,
    stalls: r.stalls,
    runAt: r.run_at,
  }));
}
