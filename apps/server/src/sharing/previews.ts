import type { Kysely } from "kysely";
import type { IndexTransform } from "../api/spa.ts";
import type { Database } from "../db/schema.ts";
import { fillIndex, linkCodeOf, ogTags } from "./og.ts";

/** The SPA handler's transform for `/s/<code>`: preview tags, and never indexed. */
export function linkPreviews(
  db: Kysely<Database>,
  publicBaseUrl: string | null,
  clips = true,
): IndexTransform {
  return async (path, html, origin) => {
    const code = linkCodeOf(path);
    if (code === null) return null;
    const page = await ogTags(db, code, publicBaseUrl ?? origin, clips);
    return { html: fillIndex(html, page), headers: { "x-robots-tag": "noindex" } };
  };
}
