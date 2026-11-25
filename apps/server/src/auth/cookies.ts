import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "uroboros_session";
export const CSRF_COOKIE = "uroboros_csrf";
export const CSRF_HEADER = "x-uroboros-csrf";

/** Sets the session (HttpOnly) and CSRF (readable by the SPA) cookies. */
export function setAuthCookies(
  c: Context,
  opts: { token: string; csrf: string; maxAgeSeconds: number; secure: boolean },
): void {
  const base = {
    path: "/",
    sameSite: "Strict",
    secure: opts.secure,
    maxAge: opts.maxAgeSeconds,
  } as const;
  setCookie(c, SESSION_COOKIE, opts.token, { ...base, httpOnly: true });
  setCookie(c, CSRF_COOKIE, opts.csrf, { ...base, httpOnly: false });
}

/**
 * Whether cookies set on this response are `Secure`: always behind an https public URL, and
 * otherwise whenever the request itself arrived over https, its own scheme or, behind a trusted
 * proxy, `X-Forwarded-Proto`'s last entry (the one that proxy set). An operator who puts TLS in
 * front without setting the public URL then still never has the session cookie sent in the clear.
 */
export function secureCookiesFor(
  c: Context,
  opts: { configured: boolean; trustProxy: boolean },
): boolean {
  if (opts.configured || new URL(c.req.url).protocol === "https:") return true;
  const proto = opts.trustProxy ? c.req.header("x-forwarded-proto")?.split(",").at(-1) : undefined;
  return proto?.trim().toLowerCase() === "https";
}

export function clearAuthCookies(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure });
  deleteCookie(c, CSRF_COOKIE, { path: "/", secure });
}

export function sessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE);
}

export function csrfCookie(c: Context): string | undefined {
  return getCookie(c, CSRF_COOKIE);
}
