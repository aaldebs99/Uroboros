import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Sealing for the few secrets the server must read back (saved site logins): AES-256-GCM under
 * `UROBOROS_SECRETS_KEY`. A sealed value is `nonce (12) ‖ ciphertext ‖ tag (16)`; the additional
 * data names what it belongs to, so a sealed value copied onto another row does not open. There
 * is no key rotation: a changed key leaves old values unreadable, and their owners enter them again.
 */

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export function seal(key: Buffer, plaintext: string, aad: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/** The plaintext, or null when the value does not open (another key, other data, tampered). */
export function open(key: Buffer, sealed: Buffer, aad: string): string | null {
  if (sealed.length < NONCE_BYTES + TAG_BYTES) return null;
  const nonce = sealed.subarray(0, NONCE_BYTES);
  const tag = sealed.subarray(sealed.length - TAG_BYTES);
  const body = sealed.subarray(NONCE_BYTES, sealed.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
