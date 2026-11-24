import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  LoginSite,
  SiteLoginBody,
  SiteLogins,
  SiteLoginView,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { deleteLogin, listLogins, saveLogin } from "./store.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const siteParams = z.object({
  site: LoginSite.openapi({
    param: { name: "site", in: "path" },
    description: "The site's yt-dlp netrc machine name",
  }),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/me/site-logins",
  tags: ["site-logins"],
  summary: "The caller's saved site logins (never their passwords)",
  responses: {
    200: json(SiteLogins, "Whether logins can be saved, and the saved ones"),
    403: error("Called with an API token"),
  },
});

const saveRoute = createRoute({
  method: "put",
  path: "/api/me/site-logins/{site}",
  tags: ["site-logins"],
  summary: "Save (or replace) the caller's login for a site",
  request: {
    params: siteParams,
    body: { required: true, content: { "application/json": { schema: SiteLoginBody } } },
  },
  responses: {
    200: json(SiteLoginView, "The saved login"),
    400: error("Not a site yt-dlp signs in to, or a bad username or password"),
    403: error("Called with an API token"),
    409: error("The server has no UROBOROS_SECRETS_KEY to seal it with"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/me/site-logins/{site}",
  tags: ["site-logins"],
  summary: "Remove the caller's login for a site",
  request: { params: siteParams },
  responses: {
    204: { description: "Removed" },
    403: error("Called with an API token"),
    404: error("No saved login for that site"),
  },
});

/**
 * The caller's saved logins for yt-dlp sites (docs/downloads.md, "Site logins"). Sealed with
 * `secretsKey`; without one, nothing can be saved and saved logins read as unreadable.
 */
export function registerSiteLoginRoutes(
  app: OpenAPIHono,
  db: Kysely<Database>,
  secretsKey: Buffer | null,
): void {
  app.openapi(listRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const logins = await listLogins(db, secretsKey, userId);
    return c.json({ enabled: secretsKey !== null, logins }, 200);
  });

  app.openapi(saveRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    if (secretsKey === null) {
      throw new ApiError("conflict", "saving site logins needs UROBOROS_SECRETS_KEY on the server");
    }
    const { site } = c.req.valid("param");
    return c.json(await saveLogin(db, secretsKey, userId, site, c.req.valid("json")), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    if (!(await deleteLogin(db, userId, c.req.valid("param").site))) {
      throw new ApiError("not_found", "no saved login for that site");
    }
    return c.body(null, 204);
  });
}
