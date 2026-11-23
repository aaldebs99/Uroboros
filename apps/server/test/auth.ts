import type { Kysely } from "kysely";
import { createSession } from "../src/auth/sessions.ts";
import type { Database } from "../src/db/schema.ts";
import { insertUser } from "./users.ts";

export interface SignedIn {
  userId: string;
  token: string;
  csrf: string;
  /** `uroboros_session=…; uroboros_csrf=…` */
  cookie: string;
  /** Cookie plus the CSRF header, ready for any request. */
  headers: Record<string, string>;
}

/** Creates a local user and a session for them. */
export async function signedIn(
  db: Kysely<Database>,
  opts: { username: string; role?: "admin" | "member" },
): Promise<SignedIn> {
  const userId = await insertUser(db, opts);
  const s = await createSession(db, { userId, ttlHours: 1, userAgent: "vitest" });
  const cookie = `uroboros_session=${s.token}; uroboros_csrf=${s.csrf}`;
  return {
    userId,
    token: s.token,
    csrf: s.csrf,
    cookie,
    headers: { cookie, "x-uroboros-csrf": s.csrf },
  };
}

interface Requester {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
}

/** The same app, with every `request` carrying the signed-in session's cookie and CSRF header. */
export function asUser<T extends Requester>(app: T, session: SignedIn): T {
  const request = app.request.bind(app);
  const wrapped = Object.create(app) as T;
  wrapped.request = (input: string, init: RequestInit = {}) =>
    request(input, {
      ...init,
      headers: { ...session.headers, ...(init.headers as Record<string, string> | undefined) },
    });
  return wrapped;
}
