import { createECDH } from "node:crypto";
import type { Kysely } from "kysely";
import { generateVAPIDKeys } from "web-push";
import type { Database } from "../db/schema.ts";
import type { VapidKeys } from "./sender.ts";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function bytes(value: string): Buffer | null {
  return BASE64URL.test(value) ? Buffer.from(value, "base64url") : null;
}

/**
 * Why a configured VAPID pair is unusable, or null when it is sound: both halves base64url, the
 * public one an uncompressed P-256 point, the private one a 32-byte scalar whose point it is.
 */
export function vapidPairProblem(publicKey: string, privateKey: string): string | null {
  const pub = bytes(publicKey);
  if (pub?.length !== 65 || pub[0] !== 4) {
    return "the VAPID public key is not a base64url uncompressed P-256 point (65 bytes)";
  }
  const priv = bytes(privateKey);
  if (priv?.length !== 32) return "the VAPID private key is not a base64url 32-byte P-256 key";
  try {
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) {
      return "the VAPID public key is not the public half of the private key";
    }
  } catch {
    return "the VAPID private key is not a valid P-256 key";
  }
  return null;
}

async function storedKeys(db: Kysely<Database>): Promise<VapidKeys | null> {
  const row = await db
    .selectFrom("vapid_keys")
    .select(["public_key", "private_key"])
    .where("id", "=", 1)
    .executeTakeFirst();
  return row ? { publicKey: row.public_key, privateKey: row.private_key } : null;
}

/**
 * The deployment's generated VAPID pair. The first replica to ask inserts a fresh one; a racing
 * replica's insert does nothing, and every replica reads back the same row, so all of them sign
 * with one key. Changing it later drops every browser's subscription, so it is never replaced.
 */
export async function ensureVapidKeys(db: Kysely<Database>): Promise<VapidKeys> {
  const existing = await storedKeys(db);
  if (existing) return existing;
  const fresh = generateVAPIDKeys();
  await db
    .insertInto("vapid_keys")
    .values({ id: 1, public_key: fresh.publicKey, private_key: fresh.privateKey })
    .onConflict((oc) => oc.column("id").doNothing())
    .execute();
  const stored = await storedKeys(db);
  if (!stored) throw new Error("vapid_keys has no row after inserting one");
  return stored;
}
