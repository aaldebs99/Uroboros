/**
 * Every Postgres advisory lock key Uroboros takes, in one place so no two collide.
 *
 * A role (one replica does this) has a fixed key: its 8-byte ASCII name read as a big-endian
 * int64, as Djinn names its leader locks ("DJINN_SC"). A lock per resource (one replica works on
 * this row) is 4 ASCII bytes of namespace followed by the first 4 bytes of the resource's sha256,
 * so namespaces never meet and `pg_locks` shows which kind a key is. Every such key starts with a
 * printable ASCII byte, so it is above 2^32 and never equals the migration runner's int4
 * `hashtext()` key.
 */
import { createHash } from "node:crypto";

const ASCII = /^[\x20-\x7e]*$/;

/** The migration runner's lock is `hashtext(MIGRATE_KEY_NAME)`: earlier releases lock on it too. */
export const MIGRATE_KEY_NAME = "uroboros_migrate";

/** A role's key: exactly 8 printable ASCII bytes, big-endian. */
export function roleKey(name: string): bigint {
  if (name.length !== 8 || !ASCII.test(name)) {
    throw new Error(`a role key needs exactly 8 ASCII bytes, got "${name}"`);
  }
  return Buffer.from(name, "ascii").readBigInt64BE(0);
}

/**
 * A per-resource key: a 4-byte ASCII namespace, then the first 4 bytes of sha256(resource). The
 * namespaces: `DOWN` (a person's download dispatch), `PUSH` (a person's push devices), `UPLD`
 * (a person's unfinished uploads), `GRPS` (the groups a person makes), `TOKN` (a person's API
 * tokens, counted against the cap) and `CAPS` (a media's captions, read for search).
 */
export function lockKey(namespace: string, resource: string): bigint {
  if (namespace.length !== 4 || !ASCII.test(namespace)) {
    throw new Error(`a lock namespace needs exactly 4 ASCII bytes, got "${namespace}"`);
  }
  const bytes = Buffer.concat([
    Buffer.from(namespace, "ascii"),
    createHash("sha256").update(resource).digest().subarray(0, 4),
  ]);
  return bytes.readBigInt64BE(0);
}

/**
 * The general leader: one replica holds it at a time and runs the singleton work: the sweeper
 * (expired sessions, sign-ins and short-lived rows), the reconcilers, the reaper, and queueing the
 * subscriptions' due checks.
 */
export const URO_LEAD = roleKey("URO_LEAD");

/**
 * One OIDC claims-sync pass at a time across replicas: refresh tokens rotate and are single-use,
 * so two replicas redeeming the same one would look like a revocation (Djinn's OIDC_SYNC_KEY).
 */
export const URO_OSYN = roleKey("URO_OSYN");

/** Every fixed role key, for the uniqueness test. */
export const ROLE_KEYS = { URO_LEAD, URO_OSYN } as const;
