import { AuthMethods, LogoutResult, Me, type LocalLoginBody } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";

import { ApiError, getJson, postJson, postNoContent, queryKeys } from "./client";

/** The signed-in user, or null when nobody is (a 401). */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async ({ signal }) => {
      try {
        return await getJson("/api/me", Me, { signal });
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}

export function useAuthMethods() {
  return useQuery({
    queryKey: queryKeys.authMethods,
    queryFn: ({ signal }) => getJson("/api/auth/methods", AuthMethods, { signal }),
  });
}

/** Signs in with a local account; the session and CSRF cookies arrive with the 204. */
export function signInLocal(body: LocalLoginBody): Promise<void> {
  return postNoContent("/api/auth/local/login", body);
}

/** Signs out of this browser; SSO users should then be sent to `endSessionUrl`. */
export function signOut(): Promise<LogoutResult> {
  return postJson("/api/auth/logout", LogoutResult);
}
