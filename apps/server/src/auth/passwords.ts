import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/** OWASP's argon2id minimum: 19 MiB, 2 passes, 1 lane. */
const DEFAULTS = { memory: 19_456, passes: 2, parallelism: 1 };
const TAG_BYTES = 32;
const SALT_BYTES = 16;
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

interface Params {
  memory: number;
  passes: number;
  parallelism: number;
}

const b64 = (buf: Buffer) => buf.toString("base64").replace(/=+$/, "");

function derive(password: string, salt: Buffer, p: Params, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: password,
        nonce: salt,
        parallelism: p.parallelism,
        tagLength,
        memory: p.memory,
        passes: p.passes,
      },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

/** An argon2id PHC string (`$argon2id$v=19$m=…,t=…,p=…$salt$hash`), on Node's built-in argon2. */
export async function hashPassword(
  password: string,
  params: Partial<Params> = {},
): Promise<string> {
  const p = { ...DEFAULTS, ...params };
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, p, TAG_BYTES);
  return `$argon2id$v=19$m=${String(p.memory)},t=${String(p.passes)},p=${String(p.parallelism)}$${b64(salt)}$${b64(tag)}`;
}

/** Whether `password` matches the stored hash, using the hash's own parameters. Never throws. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const m = PHC.exec(hash);
  if (m === null) return false;
  const [, mem, passes, lanes, salt, tag] = m;
  const expected = Buffer.from(tag ?? "", "base64");
  if (expected.length === 0) return false;
  try {
    const actual = await derive(
      password,
      Buffer.from(salt ?? "", "base64"),
      { memory: Number(mem), passes: Number(passes), parallelism: Number(lanes) },
      expected.length,
    );
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Verified against when the username is unknown, so the answer takes as long as a wrong password.
 * Its tag is random bytes nobody knows the password for.
 */
export const DUMMY_HASH = `$argon2id$v=19$m=${String(DEFAULTS.memory)},t=${String(DEFAULTS.passes)},p=${String(DEFAULTS.parallelism)}$${b64(randomBytes(SALT_BYTES))}$${b64(randomBytes(TAG_BYTES))}`;
