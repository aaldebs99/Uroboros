import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorBody, LibraryEntry } from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { currentPrincipal } from "../api/principal.ts";
import { listLibrary, removeEntry } from "./library.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const idParams = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" } }) });

const listRoute = createRoute({
  method: "get",
  path: "/api/library",
  tags: ["library"],
  summary: "The caller's library, newest first",
  responses: { 200: json(z.array(LibraryEntry), "Entries") },
});

const removeRoute = createRoute({
  method: "delete",
  path: "/api/library/{id}",
  tags: ["library"],
  summary: "Remove an entry from the caller's library (the shared file stays)",
  request: { params: idParams },
  responses: { 204: { description: "Removed" }, 404: json(ApiErrorBody, "No such entry") },
});

export function registerLibraryRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(listRoute, async (c) =>
    c.json(await listLibrary(db, currentPrincipal(c).userId), 200),
  );
  app.openapi(removeRoute, async (c) => {
    await removeEntry(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
