import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SHAPE = /^[0-9a-f]{64}$/;

/** A fresh random secret: 32 bytes as 64 lowercase hex characters (sessions, CSRF, API tokens). */
export function newSecret(): string {
  return randomBytes(32).toString("hex");
}

/** The SHA-256 a secret is stored as. */
export function digest(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

/** Whether a string could be one of our secrets; anything else is never looked up. */
export function isSecretShape(value: string): boolean {
  return SHAPE.test(value);
}

/** Constant-time equality for two strings (false on a length mismatch). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
