/** `push_devices`: the browsers that take a user's notifications. */
import { createHash } from "node:crypto";
import type { Kysely, Selectable } from "kysely";
import type { Database, PushDevicesTable } from "../db/schema.ts";

export type DeviceRow = Selectable<PushDevicesTable>;

export interface NewDevice {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  label: string;
}

export function listDevices(db: Kysely<Database>, userId: string): Promise<DeviceRow[]> {
  return db
    .selectFrom("push_devices")
    .selectAll()
    .where("user_id", "=", userId)
    .orderBy("created_at")
    .orderBy("id")
    .execute();
}

export async function findDevice(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<DeviceRow | null> {
  const row = await db
    .selectFrom("push_devices")
    .selectAll()
    .where("user_id", "=", userId)
    .where("id", "=", id)
    .executeTakeFirst();
  return row ?? null;
}

/**
 * Keeps a subscription. The endpoint is its identity: subscribing again on one replaces its keys
 * and label and clears an old failure, rather than adding a second device.
 */
export function upsertDevice(db: Kysely<Database>, device: NewDevice): Promise<DeviceRow> {
  return db
    .insertInto("push_devices")
    .values({
      user_id: device.userId,
      endpoint: device.endpoint,
      p256dh: device.p256dh,
      auth: device.auth,
      label: device.label,
    })
    .onConflict((oc) =>
      oc.column("endpoint").doUpdateSet((eb) => ({
        user_id: eb.ref("excluded.user_id"),
        p256dh: eb.ref("excluded.p256dh"),
        auth: eb.ref("excluded.auth"),
        label: eb.ref("excluded.label"),
        failed_at: null,
      })),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** The key a turned-off endpoint is remembered by. */
export function endpointHash(endpoint: string): Buffer {
  return createHash("sha256").update(endpoint).digest();
}

/**
 * Removes one of `userId`'s devices and remembers its endpoint as turned off, so that browser's
 * launch-time sync does not quietly turn it back on. False when they have no device with that id.
 */
export async function deleteDevice(
  db: Kysely<Database>,
  userId: string,
  id: string,
): Promise<boolean> {
  return db.transaction().execute(async (tx) => {
    const gone = await tx
      .deleteFrom("push_devices")
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .returning("endpoint")
      .executeTakeFirst();
    if (gone === undefined) return false;
    await tx
      .insertInto("push_device_tombstones")
      .values({ endpoint_hash: endpointHash(gone.endpoint), user_id: userId })
      .onConflict((oc) =>
        oc.column("endpoint_hash").doUpdateSet({ user_id: userId, deleted_at: new Date() }),
      )
      .execute();
    return true;
  });
}

/** Whether `endpoint` is one of `userId`'s devices, and whether they turned it off elsewhere. */
export async function endpointStatus(
  db: Kysely<Database>,
  userId: string,
  endpoint: string,
): Promise<{ known: boolean; turnedOffElsewhere: boolean }> {
  const [device, tomb] = await Promise.all([
    db
      .selectFrom("push_devices")
      .select("id")
      .where("user_id", "=", userId)
      .where("endpoint", "=", endpoint)
      .executeTakeFirst(),
    db
      .selectFrom("push_device_tombstones")
      .select("user_id")
      .where("endpoint_hash", "=", endpointHash(endpoint))
      .where("user_id", "=", userId)
      .executeTakeFirst(),
  ]);
  return { known: device !== undefined, turnedOffElsewhere: tomb !== undefined };
}

/** Drops a device its push service says is gone, whoever owns it. */
export async function forgetDevice(db: Kysely<Database>, id: string): Promise<void> {
  await db.deleteFrom("push_devices").where("id", "=", id).execute();
}

/** Records how the last push to a device went. */
export async function markDevice(
  db: Kysely<Database>,
  id: string,
  delivered: boolean,
  at: Date,
): Promise<void> {
  await db
    .updateTable("push_devices")
    .set(delivered ? { last_success_at: at } : { failed_at: at })
    .where("id", "=", id)
    .execute();
}
