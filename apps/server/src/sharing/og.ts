import type { Kysely } from "kysely";
import type { Database } from "../db/schema.ts";
import { linkShare } from "./access.ts";
import { itemBase } from "./public.ts";
import { describeTarget } from "./targets.ts";

/** A link page's title and the tags that go in its `<head>`. */
export interface LinkPage {
  title: string | null;
  tags: string;
}

const ROBOTS = '<meta name="robots" content="noindex">';

/** Escapes text for an HTML attribute or element. */
export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const meta = (attr: "property" | "name", key: string, value: string) =>
  `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;

/** `/s/<code>`'s path, when a path is one. */
export function linkCodeOf(path: string): string | null {
  return /^\/s\/([A-Za-z0-9_-]{1,64})\/?$/.exec(path)?.[1] ?? null;
}

/**
 * Open Graph tags for a public link, so a chat that unfurls it shows the title and thumbnail
 * (crawlers run no script). `base` is the public origin. A dead code gets only the robots tag.
 */
export async function ogTags(db: Kysely<Database>, code: string, base: string): Promise<LinkPage> {
  const share = await linkShare(db, code);
  if (share === undefined) return { title: null, tags: ROBOTS };
  const facts = await describeTarget(db, share.ownerId, share.target.kind, share.target.id);
  const isVideo = share.target.kind === "entry";
  const description =
    facts.description?.trim().slice(0, 200) ||
    (isVideo ? "A video on Uroboros" : "A playlist on Uroboros");
  const image =
    facts.coverEntryId === null ? null : `${base}${itemBase(code, facts.coverEntryId)}/thumbnail`;
  const tags = [
    meta("property", "og:title", facts.title),
    meta("property", "og:description", description),
    meta("property", "og:type", "video.other"),
    meta("property", "og:url", `${base}/s/${code}`),
    ...(image === null ? [] : [meta("property", "og:image", image)]),
    meta("name", "twitter:card", image === null ? "summary" : "summary_large_image"),
    ROBOTS,
  ];
  return { title: facts.title, tags: tags.join("\n    ") };
}

/** `index.html` with a link page's tags before `</head>` and its title in `<title>`. */
export function fillIndex(html: string, page: LinkPage): string {
  // Replacer functions, never replacement strings: a title is the uploader's text, and `$&`,
  // `` $` ``, `$'` or `$$` in a replacement string would expand into pieces of the page.
  const { title } = page;
  const titled =
    title === null
      ? html
      : html.replace(
          /<title>[^<]*<\/title>/,
          () => `<title>${escapeHtml(title)} · Uroboros</title>`,
        );
  return titled.replace("</head>", () => `    ${page.tags}\n  </head>`);
}
