import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";

/** The largest request body `/api/*` accepts by default; `UROBOROS_BODY_LIMIT_BYTES` moves it. */
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

/**
 * The SPA's policy: everything from its own origin, no inline script (the pre-paint theme script
 * is the file `/theme-init.js`). Styles allow 'unsafe-inline' because sonner and Radix inject
 * `<style>` elements at runtime; Tailwind itself is one stylesheet from the origin.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/**
 * Swagger UI's policy: its scripts and stylesheet come from the origin (src/api/docs.ts), but it
 * sets inline styles and draws its icons from data: URIs.
 */
const DOCS_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const isDocs = (path: string) => path === "/api/docs" || path.startsWith("/api/docs/");

/**
 * Hono's secure headers, with X-Frame-Options DENY and a referrer that keeps the origin across
 * sites. HSTS is left to whatever terminates TLS: the api itself only ever speaks plain HTTP.
 */
export function securityHeaders(): MiddlewareHandler[] {
  return [
    secureHeaders({
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: false,
    }),
    async (c, next) => {
      await next();
      c.res.headers.set("Content-Security-Policy", isDocs(c.req.path) ? DOCS_CSP : APP_CSP);
    },
  ];
}

/** Refuses a request body over `maxSize` bytes; the 413 it throws becomes `payload_too_large`. */
export function apiBodyLimit(maxSize: number): MiddlewareHandler {
  return bodyLimit({ maxSize });
}
