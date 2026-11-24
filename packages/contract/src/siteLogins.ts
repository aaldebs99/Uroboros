import { z } from "@hono/zod-openapi";

import { LOGIN_SITES } from "./generated/loginSites.ts";

export { LOGIN_SITES };

/**
 * A site yt-dlp can sign in to with a username and password, by its netrc machine name ("vimeo",
 * "twitch"). The list is generated from the pinned yt-dlp (`mise run gen:login-sites`).
 */
export const LoginSite = z.enum(LOGIN_SITES).openapi("LoginSite");
export type LoginSite = z.infer<typeof LoginSite>;

/** No control characters: a value goes into a netrc file line as one quoted token. */
const Secretish = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !/\p{Cc}/u.test(value), "no control characters");

/**
 * One of the caller's saved logins. The password never comes back: `unreadable` means the server
 * can no longer decrypt it (its UROBOROS_SECRETS_KEY changed), so it must be entered again.
 */
export const SiteLoginView = z
  .object({
    site: LoginSite,
    username: z.string(),
    state: z.enum(["ok", "unreadable"]),
    updatedAt: z.iso.datetime(),
  })
  .openapi("SiteLoginView");
export type SiteLoginView = z.infer<typeof SiteLoginView>;

/** The caller's saved logins; `enabled` is false when the server cannot save any (no key). */
export const SiteLogins = z
  .object({ enabled: z.boolean(), logins: z.array(SiteLoginView) })
  .openapi("SiteLogins");
export type SiteLogins = z.infer<typeof SiteLogins>;

/** Saves (or replaces) the caller's login for one site. */
export const SiteLoginBody = z
  .object({ username: Secretish(256), password: Secretish(1024) })
  .openapi("SiteLoginBody");
export type SiteLoginBody = z.infer<typeof SiteLoginBody>;
