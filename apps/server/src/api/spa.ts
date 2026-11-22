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
};

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
 * Serves a built SPA: a file under `webDist` if the path names one, otherwise `index.html` so
 * client-side routes work. Returns null only when there is no index.html either.
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
        const immutable = decoded.startsWith("/assets/");
        return respond(
          file,
          candidate,
          immutable ? "public, max-age=31536000, immutable" : "no-cache",
        );
      }
    }
    const indexPath = join(root, "index.html");
    const index = await readIfFile(indexPath);
    return index ? respond(index, indexPath, "no-cache") : null;
  };
}
