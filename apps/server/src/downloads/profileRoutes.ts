import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorBody,
  FormatProfile,
  FormatProfilePatch,
  NewFormatProfileBody,
} from "@uroboros/contract";
import { normalizeExtraArgs } from "@uroboros/ytdlp/flags";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { ApiError } from "../api/errors.ts";
import { currentPrincipal } from "../api/principal.ts";
import { requireAdmin } from "../auth/guard.ts";
import { argsOf, getProfile, profileRevision, toProfile, type ProfileArgs } from "./profiles.ts";

const UNIQUE_VIOLATION = "23505";
const RESTRICT_VIOLATION = "23001";
const FK_VIOLATION = "23503";

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
  summary: "The format profiles to pick from (the default first)",
  responses: { 200: json(z.array(FormatProfile), "Profiles") },
});

const createProfileRoute = createRoute({
  method: "post",
  path: "/api/admin/format-profiles",
  tags: ["admin"],
  summary: "Add a format profile",
  request: body(NewFormatProfileBody),
  responses: {
    201: json(FormatProfile, "Added"),
    400: error("A refused yt-dlp argument, or audio-only without an audio format"),
    403: error("Admins only"),
    409: error("The name is taken"),
  },
});

const patchRoute = createRoute({
  method: "patch",
  path: "/api/admin/format-profiles/{id}",
  tags: ["admin"],
  summary: "Edit a format profile; edits apply to downloads queued afterwards",
  request: { params: idParams, ...body(FormatProfilePatch) },
  responses: {
    200: json(FormatProfile, "Edited"),
    400: error("A refused yt-dlp argument, or audio-only without an audio format"),
    403: error("Admins only"),
    404: error("No such profile"),
    409: error("The name is taken"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/admin/format-profiles/{id}",
  tags: ["admin"],
  summary: "Delete an unused format profile",
  request: { params: idParams },
  responses: {
    204: { description: "Deleted" },
    403: error("Admins only"),
    404: error("No such profile"),
    409: error("The default profile, or one that downloads or files use"),
  },
});

/** Checks and canonicalizes the arguments; throws `bad_request`. */
function checked(args: ProfileArgs): ProfileArgs {
  if (args.audioOnly !== (args.audioFormat !== null)) {
    throw new ApiError("bad_request", "an audio-only profile needs an audio format, and only it");
  }
  try {
    return { ...args, extraArgs: normalizeExtraArgs(args.extraArgs) };
  } catch (err) {
    throw new ApiError("bad_request", err instanceof Error ? err.message : String(err));
  }
}

function codeOf(err: unknown): string | undefined {
  return (err as { code?: string }).code;
}

function nameTaken(err: unknown): never {
  if (codeOf(err) === UNIQUE_VIOLATION)
    throw new ApiError("conflict", "a profile with that name exists");
  throw err;
}

export function registerProfileRoutes(app: OpenAPIHono, db: Kysely<Database>): void {
  app.openapi(listRoute, async (c) => {
    const rows = await db
      .selectFrom("format_profiles")
      .selectAll()
      .orderBy("is_default", "desc")
      .orderBy("name")
      .execute();
    return c.json(rows.map(toProfile), 200);
  });

  app.openapi(createProfileRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const b = c.req.valid("json");
    const args = checked({
      format: b.format,
      mergeFormat: b.mergeFormat,
      audioOnly: b.audioOnly,
      audioFormat: b.audioFormat,
      extraArgs: b.extraArgs,
    });
    const row = await db
      .insertInto("format_profiles")
      .values({
        name: b.name,
        format: args.format,
        merge_format: args.mergeFormat,
        audio_only: args.audioOnly,
        audio_format: args.audioFormat,
        extra_args: args.extraArgs,
        revision: profileRevision(args),
      })
      .returningAll()
      .executeTakeFirstOrThrow()
      .catch(nameTaken);
    return c.json(toProfile(row), 201);
  });

  app.openapi(patchRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const { id } = c.req.valid("param");
    const patch = c.req.valid("json");
    const current = await getProfile(db, id);
    if (current === undefined) throw new ApiError("not_found", "no such profile");
    const old = argsOf(current);
    const args = checked({
      format: patch.format ?? old.format,
      mergeFormat: patch.mergeFormat === undefined ? old.mergeFormat : patch.mergeFormat,
      audioOnly: patch.audioOnly ?? old.audioOnly,
      audioFormat: patch.audioFormat === undefined ? old.audioFormat : patch.audioFormat,
      extraArgs: patch.extraArgs ?? old.extraArgs,
    });
    const row = await db
      .transaction()
      .execute(async (tx) => {
        if (patch.isDefault === true) {
          await tx
            .updateTable("format_profiles")
            .set({ is_default: false })
            .where("is_default", "=", true)
            .where("id", "!=", id)
            .execute();
        }
        return tx
          .updateTable("format_profiles")
          .set({
            name: patch.name ?? current.name,
            format: args.format,
            merge_format: args.mergeFormat,
            audio_only: args.audioOnly,
            audio_format: args.audioFormat,
            extra_args: args.extraArgs,
            revision: profileRevision(args),
            updated_at: new Date(),
            ...(patch.isDefault === true ? { is_default: true } : {}),
          })
          .where("id", "=", id)
          .returningAll()
          .executeTakeFirstOrThrow();
      })
      .catch(nameTaken);
    return c.json(toProfile(row), 200);
  });

  app.openapi(deleteRoute, async (c) => {
    requireAdmin(currentPrincipal(c));
    const { id } = c.req.valid("param");
    const current = await getProfile(db, id);
    if (current === undefined) throw new ApiError("not_found", "no such profile");
    if (current.is_default)
      throw new ApiError("conflict", "choose another default before deleting this one");
    try {
      await db.deleteFrom("format_profiles").where("id", "=", id).execute();
    } catch (err) {
      if (codeOf(err) === RESTRICT_VIOLATION || codeOf(err) === FK_VIOLATION) {
        throw new ApiError("conflict", "downloads or stored files use this profile");
      }
      throw err;
    }
    return c.body(null, 204);
  });
}
