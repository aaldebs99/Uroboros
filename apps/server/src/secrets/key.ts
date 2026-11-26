import { argon2Sync } from "node:crypto";

/**
 * The 32-byte key saved site logins are sealed with (`seal.ts`), from `UROBOROS_SECRETS_KEY`.
 *
 * A value in the old form, 32 bytes of standard base64 (`openssl rand -base64 32`), is the key
 * itself, as it was before any passphrase was taken, so the logins saved under it keep opening.
 * Any other value is a passphrase (the docs suggest `openssl rand -hex 32`), stretched with
 * argon2id at OWASP's minimum (19 MiB, 2 passes, 1 lane): slow enough that guessing a short one from
 * a copy of the database costs real work, run once when a process starts. The salt is fixed,
 * because a random one would have to be stored, and the only place for it is the database that
 * holds the sealed values. Neither the salt nor the parameters may ever change: every saved login
 * depends on them (`key.test.ts` pins them).
 */
const OLD_FORM = /^[A-Za-z0-9+/]{43}=$/;
const SALT = Buffer.from("uroboros:site-logins:v1", "utf8");
const KEY_BYTES = 32;

export function secretsKeyFrom(value: string): Buffer {
  if (OLD_FORM.test(value)) return Buffer.from(value, "base64");
  return argon2Sync("argon2id", {
    message: value,
    nonce: SALT,
    parallelism: 1,
    tagLength: KEY_BYTES,
    memory: 19_456,
    passes: 2,
  });
}
