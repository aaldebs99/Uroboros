import type { InstanceSettings, InstanceSettingsPatch } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";

/** Every setting's value before an admin first changes one (no row yet). */
const DEFAULTS: InstanceSettings = { mcpEnabled: false };

/**
 * The instance's settings, read fresh on every call: a change made on one replica holds on every
 * replica at once, with no cache to go stale.
 */
export async function readInstanceSettings(db: Kysely<Database>): Promise<InstanceSettings> {
  const row = await db
    .selectFrom("instance_settings")
    .select("mcp_enabled")
    .where("id", "=", 1)
    .executeTakeFirst();
  return row === undefined ? DEFAULTS : { mcpEnabled: row.mcp_enabled };
}

/** Applies a change (creating the row on the first), records who made it, and returns the result. */
export async function writeInstanceSettings(
  db: Kysely<Database>,
  patch: InstanceSettingsPatch,
  userId: string,
): Promise<InstanceSettings> {
  const mcpEnabled = patch.mcpEnabled ?? (await readInstanceSettings(db)).mcpEnabled;
  const row = await db
    .insertInto("instance_settings")
    .values({ id: 1, mcp_enabled: mcpEnabled, updated_by: userId })
    .onConflict((oc) =>
      oc
        .column("id")
        .doUpdateSet({ mcp_enabled: mcpEnabled, updated_by: userId, updated_at: new Date() }),
    )
    .returning("mcp_enabled")
    .executeTakeFirstOrThrow();
  return { mcpEnabled: row.mcp_enabled };
}
