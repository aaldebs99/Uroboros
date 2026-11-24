import { z } from "zod";

/**
 * Lenient field schemas for yt-dlp's JSON. yt-dlp adds, drops and retypes fields between releases
 * and extractors, so a field that is missing or has the wrong type becomes null (or empty) instead
 * of failing the whole document, and unknown fields are stripped.
 */

export const str = z
  .string()
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

export const num = z
  .number()
  .refine(Number.isFinite)
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

export const bool = z
  .boolean()
  .nullish()
  .catch(null)
  .transform((v) => v ?? null);

/** An array whose malformed elements (null entries included) are dropped one by one. */
export function list<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .nullish()
    .catch(null)
    .transform((values) =>
      (values ?? []).flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data] : [];
      }),
    );
}

/** As `list`, but null rather than empty when the field is missing or not an array at all. */
export function maybeList<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .nullish()
    .catch(null)
    .transform((values) => (values == null ? null : list(item).parse(values)));
}

/** A record of arrays (yt-dlp's subtitles by language), each array as lenient as `list`. */
export function listRecord<T extends z.ZodType>(item: T) {
  const values = list(item);
  return z
    .record(z.string(), z.unknown())
    .nullish()
    .catch(null)
    .transform((record) => {
      const out: Record<string, z.output<T>[]> = {};
      for (const [key, value] of Object.entries(record ?? {})) {
        const parsed = values.parse(value);
        if (parsed.length > 0) out[key] = parsed;
      }
      return out;
    });
}
