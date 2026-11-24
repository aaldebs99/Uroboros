import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  DefaultProfileBody,
  FormatProfile,
  FormatProfilePatch,
  NewFormatProfileBody,
} from "@uroboros/contract";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { currentPrincipal } from "../api/principal.ts";
import { chooseDefault, createProfile, editProfile, removeProfile } from "./profileEdits.ts";
import { defaultProfileFor, profilesFor, toProfile, type ProfileRow } from "./profiles.ts";

const json = <S extends z.ZodType>(schema: S, description: string) => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(ApiErrorBody, description);
const body = <S extends z.ZodType>(schema: S) => ({
  body: { required: true, content: { "application/json": { schema } } },
});
const idParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, description: "Profile id" }),
});

const listRoute = createRoute({
  method: "get",
  path: "/api/format-profiles",
  tags: ["downloads"],
  summary: "The profiles the caller can download with: the built-ins they kept, then their own",
  responses: { 200: json(z.array(FormatProfile), "Profiles") },
});

const createProfileRoute = createRoute({
  method: "post",
  path: "/api/format-profiles",
  tags: ["downloads"],
  summary: "Add a profile of the caller's own",
  request: body(NewFormatProfileBody),
  responses: {
    201: json(FormatProfile, "Added"),
    400: error("A refused yt-dlp argument, or audio-only without an audio format"),
    409: error("Another of the caller's profiles has that name"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/format-profiles/{id}",
  tags: ["downloads"],
  summary:
    "Edit a profile; a built-in becomes the caller's own copy (a new id), for them alone. Edits apply to downloads queued afterwards",
  request: { params: idParams, ...body(FormatProfilePatch) },
  responses: {
    200: json(FormatProfile, "Edited"),
    400: error("A refused yt-dlp argument, or audio-only without an audio format"),
    404: error("No such profile the caller sees"),
    409: error("Another of the caller's profiles has that name"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/format-profiles/{id}",
  tags: ["downloads"],
  summary: "Delete one of the caller's profiles, or hide a built-in from them alone",
  request: { params: idParams },
  responses: {
    204: { description: "Deleted" },
    404: error("No such profile the caller sees"),
    409: error("Downloads, subscriptions or files in their library use it, or it is their last"),
  },
});

const defaultRoute = createRoute({
  method: "put",
  path: "/api/format-profiles/default",
  tags: ["downloads"],
  summary: "Choose the profile the caller downloads with when they pick none",
  request: body(DefaultProfileBody),
  responses: {
    204: { description: "Chosen" },
    404: error("No such profile the caller may use"),
  },
});

/** The profile as the caller sees it, marked if it is their default. */
async function shown(db: Kysely<Database>, userId: string, row: ProfileRow) {
  return toProfile(row, (await defaultProfileFor(db, userId))?.id ?? null);
}

export function registerProfileRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(listRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const [rows, fallback] = await Promise.all([
      profilesFor(db, userId),
      defaultProfileFor(db, userId),
    ]);
    return c.json(
      rows.map((row) => toProfile(row, fallback?.id ?? null)),
      200,
    );
  });

  app.openapi(createProfileRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const row = await createProfile(db, userId, c.req.valid("json"));
    return c.json(await shown(db, userId, row), 201);
  });

  app.openapi(patchRoute, async (c) => {
    const { userId } = currentPrincipal(c);
    const row = await editProfile(db, userId, c.req.valid("param").id, c.req.valid("json"));
    return c.json(await shown(db, userId, row), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    await removeProfile(db, currentPrincipal(c).userId, c.req.valid("param").id);
    return c.body(null, 204);
  });

  app.openapi(defaultRoute, async (c) => {
    await chooseDefault(db, currentPrincipal(c).userId, c.req.valid("json").profileId);
    return c.body(null, 204);
  });
}
