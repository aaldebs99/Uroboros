import { sql, type Kysely } from "kysely";
import type { Database } from "../../db/schema.ts";
import { digest, safeEqual } from "../secrets.ts";

/** How long a sign-in may wait at the provider. */
export const PENDING_TTL_SECONDS = 600;

export interface Pending {
  state: string;
  binding: string;
  nonce: string;
  verifier: string;
  returnTo: string;
}

export async function savePending(db: Kysely<Database>, p: Pending): Promise<void> {
  await db
    .insertInto("auth_logins")
    .values({
      state_hash: digest(p.state),
      binding_hash: digest(p.binding),
      nonce: p.nonce,
      pkce_verifier: p.verifier,
      return_to: p.returnTo,
      expires_at: new Date(Date.now() + PENDING_TTL_SECONDS * 1000),
    })
    .execute();
}

/**
 * Takes (deletes) the pending sign-in for `state`, once. Null when unknown or expired; a binding
 * that does not match is reported as `"binding"` (the row is still consumed).
 */
export async function takePending(
  db: Kysely<Database>,
  state: string,
  binding: string,
): Promise<{ nonce: string; verifier: string; returnTo: string } | null | "binding"> {
  const row = await db
    .deleteFrom("auth_logins")
    .where("state_hash", "=", digest(state))
    .where("expires_at", ">", sql<Date>`now()`)
    .returning(["binding_hash", "nonce", "pkce_verifier", "return_to"])
    .executeTakeFirst();
  if (row === undefined) return null;
  if (!safeEqual(row.binding_hash.toString("hex"), digest(binding).toString("hex")))
    return "binding";
  return { nonce: row.nonce, verifier: row.pkce_verifier, returnTo: row.return_to };
}

const BASE = "http://uroboros.invalid";

/** Whitespace, or a C0 control character or DEL. */
function hasSpaceOrControl(value: string): boolean {
  if (/\s/u.test(value)) return true;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * A same-origin path to return to after sign-in; anything else is `/`. Browsers drop tabs and
 * newlines while parsing a URL (`/\t/evil` becomes `//evil`), so whitespace and control characters
 * are refused outright, and what is left must still resolve to this origin.
 */
export function safeReturnTo(value: string | undefined): string {
  if (
    value === undefined ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasSpaceOrControl(value)
  ) {
    return "/";
  }
  try {
    return new URL(value, BASE).origin === BASE ? value : "/";
  } catch {
    return "/";
  }
}
