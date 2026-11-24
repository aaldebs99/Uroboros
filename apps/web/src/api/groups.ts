import {
  AdminGroup,
  GroupDetail,
  GroupShare,
  GroupSummary,
  type GroupRole,
} from "@uroboros/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { deleteJson, getJson, patchJson, postJson } from "./client";

/** Groups people make (docs/sharing.md "Groups"). */

const groupsKey = ["api", "groups"] as const;
const adminKey = ["api", "admin", "groups"] as const;
const groupPath = (id: string) => `/api/groups/${encodeURIComponent(id)}`;
const memberPath = (id: string, userId: string) =>
  `${groupPath(id)}/members/${encodeURIComponent(userId)}`;

/** The caller's groups (Shared › Groups). */
export function useGroups() {
  return useQuery({
    queryKey: groupsKey,
    queryFn: ({ signal }) => getJson("/api/groups", z.array(GroupSummary), { signal }),
  });
}

/** One of the caller's groups, with everyone in it. */
export function useGroup(id: string) {
  return useQuery({
    queryKey: [...groupsKey, id],
    queryFn: ({ signal }) => getJson(groupPath(id), GroupDetail, { signal }),
  });
}

/** What the group's members share with it. */
export function useGroupShares(id: string) {
  return useQuery({
    queryKey: [...groupsKey, id, "shares"],
    queryFn: ({ signal }) => getJson(`${groupPath(id)}/shares`, z.array(GroupShare), { signal }),
  });
}

/** Every group (Admin › Groups). */
export function useAllGroups() {
  return useQuery({
    queryKey: adminKey,
    queryFn: ({ signal }) => getJson("/api/admin/groups", z.array(AdminGroup), { signal }),
  });
}

/**
 * A change to a group. Groups decide who can be shared with and who sees what, so the group lists,
 * the share dialog's directory and both sides of Shared are fetched again afterwards.
 */
export function useGroupAction<A, R>(fn: (arg: A) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        [groupsKey, adminKey, ["api", "directory"], ["api", "shared"], ["api", "shares"]].map(
          (queryKey) => client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}

export const createGroup = (name: string) => postJson("/api/groups", GroupDetail, { name });
export const renameGroup = ({ id, name }: { id: string; name: string }) =>
  patchJson(groupPath(id), GroupDetail, { name });
export const deleteGroup = (id: string) => deleteJson(groupPath(id));
export const addMembers = ({ id, userIds }: { id: string; userIds: string[] }) =>
  postJson(`${groupPath(id)}/members`, GroupDetail, { userIds });
export const setMemberRole = ({
  id,
  userId,
  role,
}: {
  id: string;
  userId: string;
  role: GroupRole;
}) => patchJson(memberPath(id, userId), GroupDetail, { role });
/** Takes someone out of the group: the caller's own id leaves it. */
export const removeMember = ({ id, userId }: { id: string; userId: string }) =>
  deleteJson(memberPath(id, userId));
export const adminDeleteGroup = (id: string) =>
  deleteJson(`/api/admin/groups/${encodeURIComponent(id)}`);
