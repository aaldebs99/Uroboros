import type { Context } from "hono";
import type { Principal } from "../auth/guard.ts";
import { ApiError } from "./errors.ts";

export type { Principal } from "../auth/guard.ts";

/** Who the request acts for, as the auth guard resolved it; 401 when nothing did. */
export function currentPrincipal(c: Context): Principal {
  const principal = c.get("principal") as Principal | undefined;
  if (principal === undefined) throw new ApiError("unauthorized", "sign in required");
  return principal;
}
