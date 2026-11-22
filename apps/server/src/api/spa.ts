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
 * Whether a path the build lacks is a client-side route, answered with `index.html`. A name with
 * an extension (`sw.js`, `manifest.webmanifest`, `assets/x.js`) never is: answering those with
 * HTML turns a stale `index.html` into a script parse error, and a missing service worker into a
 * registration of the page itself.
 */
function isRoute(decoded: string): boolean {
  const last = decoded.split("/").pop() ?? "";
  return !decoded.startsWith("/assets/") && !last.includes(".");
}

/**
 * Serves a built SPA: a file under `webDist` if the path names one, otherwise `index.html` for a
 * client route. Returns null (a 404) for a missing file and when there is no index.html either.
 */
export function createSpaHandler(webDist: string): (urlPath: string) => Promise<Response | null> {
  const root = resolve(webDist);
  return async (urlPath) => {
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
    if (!isRoute(decoded)) return null;
    const indexPath = join(root, "index.html");
    const index = await readIfFile(indexPath);
    return index ? respond(index, indexPath, NO_STORE) : null;
  };
}
