import { createHash } from "node:crypto";

/**
 * A stored sidecar's URL under `path` (a thumbnail, a hover preview), versioned by its storage key:
 * the route lets browsers cache it for a day, and a replaced thumbnail (an upload's,
 * docs/uploads.md) gets a new key, so the URL changes with it. Null when there is none.
 */
export function thumbnailUrl(path: string, key: string | null): string | null {
  if (key === null) return null;
  return `${path}?v=${createHash("sha1").update(key).digest("hex").slice(0, 8)}`;
}
