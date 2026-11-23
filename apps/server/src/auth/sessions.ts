import { sql, type Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { digest, isSecretShape, newSecret } from "./secrets.ts";

/** `last_seen_at` is written at most this often per session. */
const SEEN_THROTTLE_MS = 60_000;

export interface NewSession {
  token: string;
  csrf: string;
  expiresAt: Date;
}

export interface ResolvedSession {
  /** The opaque id the sessions list uses (first 16 hex of the stored hash). */
  sessionId: string;
  tokenHash: Buffer;
  userId: string;
  role: "admin" | "member";
  csrf: string;
}

/** The id a session is shown and revoked by: not the token, nor enough of its hash to matter. */
export function sessionIdOf(tokenHash: Buffer): string {
  return tokenHash.toString("hex").slice(0, 16);
}

export async function createSession(
  db: Kysely<Database>,
  opts: { userId: string; ttlHours: number; userAgent: string | null },
): Promise<NewSession> {
  const token = newSecret();
  const csrf = newSecret();
  const expiresAt = new Date(Date.now() + opts.ttlHours * 3_600_000);
  await db
    .insertInto("auth_sessions")
    .values({
      token_hash: digest(token),
      user_id: opts.userId,
      csrf,
      user_agent: opts.userAgent?.slice(0, 512) ?? null,
      expires_at: expiresAt,
    })
    .execute();
  return { token, csrf, expiresAt };
}

/** The live session for a cookie token: null when unknown, expired, or its user is disabled or revoked. */
export async function resolveSession(
  db: Kysely<Database>,
  token: string,
): Promise<ResolvedSession | null> {
  if (!isSecretShape(token)) return null;
  const tokenHash = digest(token);
  const row = await db
    .selectFrom("auth_sessions as s")
    .innerJoin("users as u", "u.id", "s.user_id")
    .select(["s.user_id", "s.csrf", "s.last_seen_at", "u.role"])
    .where("s.token_hash", "=", tokenHash)
    .where("s.expires_at", ">", sql<Date>`now()`)
    .where("u.disabled_at", "is", null)
    .where("u.revoked_at", "is", null)
    .executeTakeFirst();
  if (row === undefined) return null;
  if (Date.now() - row.last_seen_at.getTime() > SEEN_THROTTLE_MS) {
    await db
      .updateTable("auth_sessions")
      .set({ last_seen_at: new Date() })
      .where("token_hash", "=", tokenHash)
      .execute();
  }
  return {
    sessionId: sessionIdOf(tokenHash),
    tokenHash,
    userId: row.user_id,
    role: row.role,
    csrf: row.csrf,
  };
}

export async function deleteSession(db: Kysely<Database>, tokenHash: Buffer): Promise<void> {
  await db.deleteFrom("auth_sessions").where("token_hash", "=", tokenHash).execute();
}

export async function listSessions(db: Kysely<Database>, userId: string) {
  const rows = await db
    .selectFrom("auth_sessions")
    .select(["token_hash", "user_agent", "created_at", "last_seen_at"])
    .where("user_id", "=", userId)
    .where("expires_at", ">", sql<Date>`now()`)
    .orderBy("last_seen_at", "desc")
    .execute();
  return rows.map((r) => ({
    id: sessionIdOf(r.token_hash),
    tokenHash: r.token_hash,
    userAgent: r.user_agent,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
  }));
}

/** Signs the user out everywhere except the session whose hash is `keep` (null: everywhere). */
export async function deleteOtherSessions(
  db: Kysely<Database>,
  userId: string,
  keep: Buffer | null,
): Promise<void> {
  let q = db.deleteFrom("auth_sessions").where("user_id", "=", userId);
  if (keep !== null) q = q.where("token_hash", "!=", keep);
  await q.execute();
}

/** Deletes expired sessions and pending OIDC logins; returns how many rows went. */
export async function sweepExpired(db: Kysely<Database>): Promise<number> {
  const sessions = await db
    .deleteFrom("auth_sessions")
    .where("expires_at", "<=", sql<Date>`now()`)
    .executeTakeFirst();
  const logins = await db
    .deleteFrom("auth_logins")
    .where("expires_at", "<=", sql<Date>`now()`)
    .executeTakeFirst();
  return Number(sessions.numDeletedRows) + Number(logins.numDeletedRows);
}
