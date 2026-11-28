import type { ColumnType, Generated } from "kysely";

/** The replicas' check-ins for Admin › Health (docs/health.md), kept apart from schema.ts. */

/** `replicas`: one row per running replica, written every 15 s; unlogged. */
export interface ReplicasTable {
  id: string;
  host: string;
  pid: number;
  version: string;
  started_at: ColumnType<Date, Date | string, Date | string>;
  seen_at: ColumnType<Date, Date | string | undefined, Date | string>;
  leader: Generated<boolean>;
  failing: ColumnType<string[], string[] | undefined, string[]>;
}
