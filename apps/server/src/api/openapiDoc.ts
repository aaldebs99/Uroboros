import type { OpenAPIHono } from "@hono/zod-openapi";

/** The document's overview, shown at the top of `/api/docs` (Markdown). */
const OVERVIEW = `Everything the web app does goes through this API, so a script can do it too.

## Signing in

**With a token** (scripts): create a personal API token in the web app under Account › Tokens
and send it as \`Authorization: Bearer <token>\`. A token acts as its owner, needs no CSRF header,
and is refused (403) on \`/api/admin/*\`, \`/api/me/tokens*\`, \`/api/me/password\`,
\`/api/me/sessions*\`, \`/api/me/push*\` and \`/api/me/site-logins*\`, so a leaked token cannot
mint another, act as an admin, change the password, move notifications or touch saved site logins.
Click **Authorize** above and paste a token to try the routes here.

A token reaches only what its scopes name: \`api\` for every route here, \`mcp\` for the MCP
server at \`/api/mcp\` (JSON-RPC, outside this document; see docs/mcp.md), and a token without the
scope gets 403. A **read-only** token gets 403 on every write (anything but GET, HEAD and OPTIONS).

**With the browser's session**: the \`uroboros_session\` cookie, set by signing in. Every write
(anything but GET, HEAD and OPTIONS) must also send the \`X-Uroboros-CSRF\` header with the value
of the \`uroboros_csrf\` cookie.

Routes marked with no security (health, readiness, sign-in, and public links under
\`/api/public/s/{code}\`) need neither: a public link's code is its own key.

## Errors

Every error is an \`ApiErrorBody\`, \`{ "code": "...", "message": "..." }\`; \`code\` decides the
status: \`bad_request\` 400, \`unauthorized\` 401, \`forbidden\` 403, \`not_found\` 404,
\`conflict\` 409, \`payload_too_large\` 413 (bodies over 64 KiB), \`unprocessable\` 422,
\`too_many_requests\` 429, \`internal\` 500, \`unavailable\` 503 (starting, or a dependency is down).
Another person's things answer 404, never 403.

## Paging

Lists that can grow page with a keyset cursor: pass the \`nextCursor\` of one page as \`cursor\`
for the next; it is \`null\` on the last. Things added while you page never cause duplicates or
gaps.

## Live progress

\`GET /api/downloads/events\` is a server-sent event stream of the caller's download changes
(state and progress), from whichever replica serves it, and of a \`notice\` nudge whenever their
notifications (\`GET /api/notices\`) change.
`;

/** The one OpenAPI document config, shared by the runtime route and `gen`. */
export function openApiConfig(version: string) {
  return {
    openapi: "3.1.0",
    info: { title: "Uroboros API", version, description: OVERVIEW },
    security: [{ bearerAuth: ["api"] }, { cookieAuth: [] }],
  };
}

/** How a caller signs in, for the document's security requirements and Swagger's Authorize. */
export function registerSecuritySchemes(app: OpenAPIHono): void {
  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    description:
      "A personal API token (Account › Tokens) with the `api` scope; a read-only one may only read.",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "uroboros_session",
    description: "The browser's session; writes also need the X-Uroboros-CSRF header.",
  });
}
