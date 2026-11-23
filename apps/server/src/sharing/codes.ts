import { randomBytes } from "node:crypto";

/** A public link's code: 128 random bits, base64url (22 characters). */
export function newCode(): string {
  return randomBytes(16).toString("base64url");
}
