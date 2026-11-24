import { z } from "@hono/zod-openapi";

/**
 * Groups people make themselves (docs/sharing.md "Groups"): anyone creates one, its managers add
 * and remove people, every member sees it and can share with it.
 */

export const GROUP_NAME_CHARS = 100;
/** The most people one group holds. */
export const MAX_GROUP_MEMBERS = 500;
/** The most groups one person may have made and still be in. */
export const MAX_GROUPS_CREATED = 50;

export const GroupName = z.string().trim().min(1).max(GROUP_NAME_CHARS).openapi("GroupName");

export const GroupRole = z.enum(["manager", "member"]).openapi("GroupRole");
export type GroupRole = z.infer<typeof GroupRole>;

/** One of the caller's groups (Shared › Groups). */
export const GroupSummary = z
  .object({
    id: z.uuid(),
    name: z.string(),
    /** The caller's role in it. */
    role: GroupRole,
    /** Its enabled members, the caller included. */
    members: z.number().int(),
  })
  .openapi("GroupSummary");
export type GroupSummary = z.infer<typeof GroupSummary>;

export const GroupMember = z
  .object({
    id: z.uuid(),
    name: z.string(),
    /** The username, or the email of an SSO account. */
    handle: z.string().nullable(),
    role: GroupRole,
    /** A disabled account stays a member, but nothing shared with the group reaches it. */
    disabled: z.boolean(),
    addedAt: z.iso.datetime(),
  })
  .openapi("GroupMember");
export type GroupMember = z.infer<typeof GroupMember>;

/** A group as its members see it: managers first, then by name. */
export const GroupDetail = z
  .object({
    id: z.uuid(),
    name: z.string(),
    role: GroupRole,
    members: z.array(GroupMember),
    createdAt: z.iso.datetime(),
  })
  .openapi("GroupDetail");
export type GroupDetail = z.infer<typeof GroupDetail>;

/** Every group, for Admin › Groups (never what is shared with them). */
export const AdminGroup = z
  .object({
    id: z.uuid(),
    name: z.string(),
    members: z.number().int(),
    /** The managers' names. */
    managers: z.array(z.string()),
    createdAt: z.iso.datetime(),
  })
  .openapi("AdminGroup");
export type AdminGroup = z.infer<typeof AdminGroup>;

/** A new group; its creator adds people on its page. */
export const NewGroupBody = z.object({ name: GroupName }).openapi("NewGroupBody");
export type NewGroupBody = z.infer<typeof NewGroupBody>;

export const GroupNameBody = z.object({ name: GroupName }).openapi("GroupNameBody");
export type GroupNameBody = z.infer<typeof GroupNameBody>;

/** People to add; any already in the group are skipped. */
export const GroupMembersBody = z
  .object({ userIds: z.array(z.uuid()).min(1).max(100) })
  .openapi("GroupMembersBody");
export type GroupMembersBody = z.infer<typeof GroupMembersBody>;

export const GroupRoleBody = z.object({ role: GroupRole }).openapi("GroupRoleBody");
export type GroupRoleBody = z.infer<typeof GroupRoleBody>;
