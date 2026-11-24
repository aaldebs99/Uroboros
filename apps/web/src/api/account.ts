import {
  AdminUser,
  NewApiToken,
  SessionView,
  TokenList,
  type AdminUserPatch,
  type ChangePasswordBody,
  type NewLocalUserBody,
} from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson, postNoContent } from "./client";

const keys = {
  sessions: ["api", "me", "sessions"] as const,
  tokens: ["api", "me", "tokens"] as const,
  users: ["api", "admin", "users"] as const,
};

/** A mutation that refreshes `key` when it settles. */
export function useRefreshing<A, R>(key: QueryKey, fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
}

export const useSessions = () =>
  useQuery({
    queryKey: keys.sessions,
    queryFn: ({ signal }) => getJson("/api/me/sessions", z.array(SessionView), { signal }),
  });
export const useSignOutSession = () =>
  useRefreshing(keys.sessions, (id: string) =>
    deleteJson(`/api/me/sessions/${encodeURIComponent(id)}`),
  );
export const useSignOutOthers = () =>
  useRefreshing(keys.sessions, () => deleteJson("/api/me/sessions"));
export const useChangePassword = () =>
  useRefreshing(keys.sessions, (body: ChangePasswordBody) =>
    postNoContent("/api/me/password", body),
  );

export const useTokens = () =>
  useQuery({
    queryKey: keys.tokens,
    queryFn: ({ signal }) => getJson("/api/me/tokens", TokenList, { signal }),
  });
export const useCreateToken = () =>
  useRefreshing(keys.tokens, (name: string) => postJson("/api/me/tokens", NewApiToken, { name }));
export const useRevokeToken = () =>
  useRefreshing(keys.tokens, (id: string) =>
    deleteJson(`/api/me/tokens/${encodeURIComponent(id)}`),
  );

const userPath = (id: string) => `/api/admin/users/${encodeURIComponent(id)}`;

export const useAdminUsers = () =>
  useQuery({
    queryKey: keys.users,
    queryFn: ({ signal }) => getJson("/api/admin/users", z.array(AdminUser), { signal }),
  });
export const useCreateUser = () =>
  useRefreshing(keys.users, (body: NewLocalUserBody) =>
    postJson("/api/admin/users", AdminUser, body),
  );
export const usePatchUser = () =>
  useRefreshing(keys.users, ({ id, patch }: { id: string; patch: AdminUserPatch }) =>
    patchJson(userPath(id), AdminUser, patch),
  );
export const useResetPassword = () =>
  useRefreshing(keys.users, ({ id, password }: { id: string; password: string }) =>
    postNoContent(`${userPath(id)}/password`, { password }),
  );
export const useDeleteUser = () =>
  useRefreshing(keys.users, (id: string) => deleteJson(userPath(id)));
export const useSyncNow = () =>
  useRefreshing(keys.users, () => postNoContent("/api/admin/users/oidc-sync"));
