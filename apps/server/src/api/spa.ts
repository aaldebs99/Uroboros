import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

/** Vite content-hashes everything under `assets/`, so those never change under one name. */
const IMMUTABLE = "public, max-age=31536000, immutable";
/**
 * Everything else (`index.html`, `sw.js`, `manifest.webmanifest`, the icons) keeps its name across
 * releases and names the current hashes, so it must never be served from a cache: a stale
 * `index.html` points at assets that are gone, and a stale `sw.js` pins the old build.
 */
const NO_STORE = "no-store";

async function readIfFile(path: string): Promise<Buffer | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

function respond(body: Buffer, path: string, cache: string): Response {
  const type = MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
  return new Response(new Uint8Array(body), {
    headers: { "content-type": type, "cache-control": cache },
  });
}

/**
 * Whether a path the build lacks is a request for a static file, answered with a 404 rather than
 * `index.html`. That is a name with an extension where the build puts files: anywhere under
 * `/assets/` (Vite's hashed output), or directly under the root (`sw.js`, `manifest.webmanifest`,
 * the icons, from `public/`). Answering those with HTML turns a stale `index.html` into a script
 * parse error, and a missing service worker into a registration of the page itself. Any other
 * path is a client route, dots and all (`/library/@john.doe`, `/watch/foo.bar`); a file that does
 * exist elsewhere in the build is served before this is asked.
 */
function isStaticFile(decoded: string): boolean {
  if (decoded.startsWith("/assets/")) return true;
  const segments = decoded.split("/").filter((s) => s !== "");
  return segments.length === 1 && extname(segments[0] ?? "") !== "";
}

/**
 * Rewrites `index.html` for a client route that needs its own `<head>` (a public link's preview
 * tags), with extra response headers; null leaves the page as built.
 */
export type IndexTransform = (
  path: string,
  html: string,
  origin: string,
) => Promise<{ html: string; headers: Record<string, string> } | null>;

/**
 * Serves a built SPA: a file under `webDist` if the path names one, otherwise `index.html` for a
 * client route. Returns null (a 404) for a missing file and when there is no index.html either.
 */
export function createSpaHandler(
  webDist: string,
  transform?: IndexTransform,
): (urlPath: string, origin?: string) => Promise<Response | null> {
  const root = resolve(webDist);
  return async (urlPath, origin = "") => {
    let decoded: string;
    try {
      decoded = decodeURIComponent(urlPath);
    } catch {
      return null;
    }
    const candidate = resolve(join(root, decoded));
    if (candidate.startsWith(root + sep)) {
      const file = await readIfFile(candidate);
      if (file) {
        return respond(file, candidate, decoded.startsWith("/assets/") ? IMMUTABLE : NO_STORE);
      }
    }
    if (isStaticFile(decoded)) return null;
    const indexPath = join(root, "index.html");
    const index = await readIfFile(indexPath);
    if (index === null) return null;
    const changed = transform ? await transform(decoded, index.toString("utf8"), origin) : null;
    if (changed === null) return respond(index, indexPath, NO_STORE);
    return new Response(changed.html, {
      headers: {
        "content-type": MIME[".html"] ?? "",
        "cache-control": NO_STORE,
        ...changed.headers,
      },
    });
  };
}
