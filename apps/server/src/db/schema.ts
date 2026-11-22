import type { ColumnType, Generated } from "kysely";

/** A `TIMESTAMPTZ`: read as a `Date`, written as a `Date` or an ISO string. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** `push_devices`: one browser's Web Push subscription (docs/push.md). */
export interface PushDevicesTable {
  id: Generated<string>;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_success_at: Timestamp | null;
  failed_at: Timestamp | null;
}

/** `vapid_keys`: the single generated VAPID pair (id is always 1). */
export interface VapidKeysTable {
  id: number;
  public_key: string;
  private_key: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

/** Kysely table map: one entry per table the migrations create. */
export interface Database {
  push_devices: PushDevicesTable;
  vapid_keys: VapidKeysTable;
}
