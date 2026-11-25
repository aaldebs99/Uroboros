import type { LayoutToken, StorageConfig } from "./config.ts";

/** What a stored file's name and folders are built from. */
export interface MediaNames {
  extractor: string;
  id: string;
  title: string | null;
  channel: string | null;
  uploader: string | null;
  /** yt-dlp's YYYYMMDD. */
  uploadDate: string | null;
  profile: string;
  ext: string;
}

const MAX_SEGMENT_BYTES = 100;

function isUnsafe(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return ch === "/" || ch === "\\" || code < 0x20 || code === 0x7f;
}

/** Cuts `value` to at most `max` UTF-8 bytes without splitting a code point. */
function cutToBytes(value: string, max: number): string {
  let out = "";
  let used = 0;
  for (const ch of value) {
    const size = Buffer.byteLength(ch, "utf8");
    if (used + size > max) break;
    out += ch;
    used += size;
  }
  return out;
}

/** The longest end of `value` that fits in `max` bytes, whole characters only. */
function keepEndBytes(value: string, max: number): string {
  const chars = Array.from(value);
  let start = chars.length;
  let used = 0;
  while (start > 0) {
    const size = Buffer.byteLength(chars[start - 1] ?? "", "utf8");
    if (used + size > max) break;
    used += size;
    start--;
  }
  return chars.slice(start).join("");
}

/**
 * One safe path segment from untrusted metadata: separators and control characters become `_`,
 * leading dots go (so never `.`, `..` or a hidden file), it is trimmed and cut to 100 bytes on a
 * character boundary, and an empty result is `_`.
 */
export function sanitizeSegment(value: string | null): string {
  const replaced = Array.from(value ?? "", (ch) => (isUnsafe(ch) ? "_" : ch)).join("");
  const trimmed = cutToBytes(replaced.trim().replace(/^\.+/, ""), MAX_SEGMENT_BYTES).trim();
  return trimmed === "" ? "_" : trimmed;
}

function dashedDate(date: string | null): string {
  const m = date === null ? null : /^(\d{4})(\d{2})(\d{2})$/.exec(date);
  return m === null ? "unknown-date" : `${m[1] ?? ""}-${m[2] ?? ""}-${m[3] ?? ""}`;
}

function year(names: MediaNames): string {
  const d = dashedDate(names.uploadDate);
  return d === "unknown-date" ? "unknown-year" : d.slice(0, 4);
}

/** Each token's raw value; exhaustive over `LayoutToken`. */
const TOKENS: Record<LayoutToken, (names: MediaNames) => string> = {
  channel: (n) => n.channel ?? n.uploader ?? "",
  uploader: (n) => n.uploader ?? n.channel ?? "",
  title: (n) => n.title ?? n.id,
  id: (n) => n.id,
  extractor: (n) => n.extractor.toLowerCase(),
  upload_date: (n) => dashedDate(n.uploadDate),
  year,
  profile: (n) => n.profile,
  ext: (n) => n.ext.toLowerCase(),
};

function tokenValue(token: LayoutToken, names: MediaNames): string {
  return TOKENS[token](names);
}

const bytes = (s: string) => Buffer.byteLength(s, "utf8");

/** The longest cuttable value at the indexes `allowed` lets through; -1 when none is left. */
function longestOf(values: readonly (string | null)[], allowed: (k: number) => boolean): number {
  let longest = -1;
  values.forEach((v, k) => {
    if (v === null || v.length <= 1 || !allowed(k)) return;
    if (longest === -1 || bytes(v) > bytes(values[longest] ?? "")) longest = k;
  });
  return longest;
}

/**
 * One segment of a layout. When it would pass 100 bytes, the longest token values are cut (never
 * the literal text), so `[{id}]`, `[{profile}]` and `.{ext}` survive a long title and different
 * videos or profiles never end up on the same path. `{id}` is cut last, and from its start: a
 * generic link's id ends in the hash that tells two same-named links apart (`library/mediaKey.ts`).
 */
function renderSegment(segment: string, names: MediaNames): string {
  const parts = segment.split(/(\{[a-z_]+\})/).filter((p) => p !== "");
  const isId = parts.map((p) => p === "{id}");
  const values = parts.map((p, k) => {
    const m = /^\{([a-z_]+)\}$/.exec(p);
    if (m === null) return null;
    const raw = tokenValue(m[1] as LayoutToken, names);
    // An id too long for a segment keeps its end as well (sanitizeSegment keeps the start).
    return sanitizeSegment(isId[k] ? keepEndBytes(raw, MAX_SEGMENT_BYTES) : raw);
  });
  const total = () => parts.reduce((n, p, k) => n + bytes(values[k] ?? p), 0);
  let excess = total() - MAX_SEGMENT_BYTES;
  while (excess > 0) {
    let k = longestOf(values, (i) => !isId[i]);
    if (k === -1) k = longestOf(values, () => true);
    const v = k === -1 ? null : values[k];
    if (v === null || v === undefined) break;
    const keep = Math.max(1, bytes(v) - excess);
    values[k] = (isId[k] ? keepEndBytes(v, keep) : cutToBytes(v, keep)).trim() || "_";
    excess = total() - MAX_SEGMENT_BYTES;
  }
  return sanitizeSegment(parts.map((p, k) => values[k] ?? p).join(""));
}

/**
 * The relative, `/`-separated path a layout gives. Every token value is sanitized on its own, and
 * every resulting segment is sanitized again, so no metadata can add a separator or a `..`.
 */
export function renderLayout(layout: string, names: MediaNames): string {
  return layout
    .split("/")
    .map((segment) => renderSegment(segment, names))
    .join("/");
}

type KeyConfig =
  | Pick<Extract<StorageConfig, { kind: "s3" }>, "kind">
  | Pick<Extract<StorageConfig, { kind: "filesystem" }>, "kind" | "layout">;

/** Where a rendition's file goes: an opaque key on S3, the layout on a filesystem. */
export function renditionKey(
  config: KeyConfig,
  mediaId: string,
  profileId: string,
  revision: string,
  names: MediaNames,
): string {
  if (config.kind === "s3") return `media/${mediaId}/${profileId}-${revision}.${names.ext}`;
  return renderLayout(config.layout, names);
}

/** Where a media's thumbnail or `.info.json` goes: beside the media file on a filesystem. */
export function sidecarKey(
  config: KeyConfig,
  mediaId: string,
  names: MediaNames,
  kind: "thumbnail" | "info",
  ext: string,
): string {
  if (config.kind === "s3")
    return `media/${mediaId}/${kind === "info" ? "info" : "thumbnail"}.${ext}`;
  const media = renderLayout(config.layout, names);
  const dir = media.includes("/") ? media.slice(0, media.lastIndexOf("/") + 1) : "";
  const base = sanitizeSegment(names.title ?? names.id);
  return `${dir}${base}${kind === "info" ? ".info" : ""}.${ext}`;
}

/**
 * Where a media's subtitle file for `lang` goes: on a filesystem, beside the media file and named
 * after it (`<file>.<lang>.vtt`), so videos that share a title never share a subtitle file.
 */
export function subtitleKey(
  config: Pick<StorageConfig, "kind">,
  mediaId: string,
  mediaKey: string,
  lang: string,
): string {
  const safe = sanitizeSegment(lang.replace(/[/\\]/g, "_"));
  if (config.kind === "s3") return `media/${mediaId}/subs/${safe}.vtt`;
  const dot = mediaKey.lastIndexOf(".");
  const slash = mediaKey.lastIndexOf("/");
  const base = dot > slash ? mediaKey.slice(0, dot) : mediaKey;
  return `${base}.${safe}.vtt`;
}
