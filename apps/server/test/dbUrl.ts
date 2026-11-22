import { randomBytes } from "node:crypto";

export const TEMPLATE_DB = "uroboros_template";

/** The same server and credentials, pointed at another database. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

/** A unique, SQL-safe database name (lowercase hex only, so it needs no quoting). */
export function uniqueTestName(): string {
  return `test_${randomBytes(8).toString("hex")}`;
}
