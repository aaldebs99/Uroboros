import { SiteLogins, SiteLoginView, type LoginSite, type SiteLoginBody } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { useRefreshing } from "./account";
import { deleteJson, getJson, putJson } from "./client";

const key = ["api", "me", "site-logins"] as const;
const path = (site: LoginSite) => `/api/me/site-logins/${encodeURIComponent(site)}`;

/** The caller's saved site logins, and whether the server can save any. */
export const useSiteLogins = () =>
  useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getJson("/api/me/site-logins", SiteLogins, { signal }),
  });

/** Saves (or replaces) the caller's login for one site. */
export const useSaveSiteLogin = () =>
  useRefreshing(key, ({ site, ...body }: SiteLoginBody & { site: LoginSite }) =>
    putJson(path(site), SiteLoginView, body),
  );

export const useRemoveSiteLogin = () =>
  useRefreshing(key, (site: LoginSite) => deleteJson(path(site)));
