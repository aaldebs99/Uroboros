import type { Context } from "hono";

/**
 * The one principal every request acts as until Users and SSO land. That step replaces
 * `currentPrincipal` with the session's user, adds the `push_devices.user_id` foreign key in a new
 * migration, and moves these rows to a real user.
 */
export const LOCAL_PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";

export interface Principal {
  /** The user the request acts for; owns rows such as `push_devices`. */
  userId: string;
}

/**
 * Who the request acts for. The only place that answers it, so the auth step changes one
 * function. When API tokens exist, the `/api/me/push` routes must refuse them: a leaked token must
 * not be able to point a person's notifications at another endpoint.
 */
export function currentPrincipal(_c: Context): Principal {
  return { userId: LOCAL_PRINCIPAL_ID };
}
