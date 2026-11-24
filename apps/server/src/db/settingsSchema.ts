import type { ColumnType } from "kysely";

/** `instance_settings`: what an admin turns on or off for the whole instance; one row (id = 1). */
export interface InstanceSettingsTable {
  id: number;
  mcp_enabled: ColumnType<boolean, boolean | undefined, boolean>;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string>;
  updated_by: string | null;
}
