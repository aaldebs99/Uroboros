import { ApiError } from "../api/errors.ts";

export interface Cursor {
  /** The last row's sort key, as text (a date is ISO). */
  key: string | number | null;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.key, c.id])).toString("base64url");
}

/** Throws `bad_request` for anything that is not a cursor this server made. */
export function decodeCursor(raw: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [key, id] = parsed as unknown[];
      const okKey = key === null || typeof key === "string" || typeof key === "number";
      if (
        okKey &&
        typeof id === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
      )
        return { key, id };
    }
  } catch {
    // reported below
  }
  throw new ApiError("bad_request", "not a valid cursor");
}
