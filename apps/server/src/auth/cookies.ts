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
