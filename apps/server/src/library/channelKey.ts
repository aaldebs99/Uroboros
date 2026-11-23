/**
 * A channel's route key: the extractor and the site's channel id, or the channel's name when the
 * site gives no id, as base64url JSON. Null when there is neither.
 */
export function channelKey(
  extractor: string,
  channelId: string | null,
  name: string | null,
): string | null {
  const parts =
    channelId !== null
      ? [extractor, "id", channelId]
      : name !== null
        ? [extractor, "name", name]
        : null;
  return parts === null ? null : Buffer.from(JSON.stringify(parts)).toString("base64url");
}

/** The parts of a key; null for anything that is not one. */
export function parseChannelKey(
  key: string,
): { extractor: string; kind: "id" | "name"; value: string } | null {
  try {
    const parts: unknown = JSON.parse(Buffer.from(key, "base64url").toString("utf8"));
    if (!Array.isArray(parts) || parts.length !== 3) return null;
    const [extractor, kind, value] = parts as unknown[];
    if (
      typeof extractor !== "string" ||
      typeof value !== "string" ||
      (kind !== "id" && kind !== "name")
    )
      return null;
    return { extractor, kind, value };
  } catch {
    return null;
  }
}
