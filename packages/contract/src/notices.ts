import { z } from "@hono/zod-openapi";

/**
 * The notification list (docs/push.md#the-list-in-the-app): everything the server told a person,
 * pushed to their devices or not, for the bell in the top bar.
 */

/** What a notice is about; the download, share and group kinds are the ones a person can mute. */
export const NoticeKind = z
  .enum(["downloads", "shares", "subscriptions", "groups"])
  .openapi("NoticeKind");
export type NoticeKind = z.infer<typeof NoticeKind>;

export const Notice = z
  .object({
    id: z.uuid(),
    kind: NoticeKind,
    title: z.string(),
    /** More lines, such as the first few titles; null when the title says it all. */
    body: z.string().nullable(),
    /** Where it leads in the app, e.g. `/downloads`. */
    path: z.string(),
    createdAt: z.iso.datetime(),
    read: z.boolean(),
  })
  .openapi("Notice");
export type Notice = z.infer<typeof Notice>;

export const NoticeList = z
  .object({
    /** The newest 50. */
    notices: z.array(Notice),
    /** How many of all of them are unread. */
    unread: z.number().int().nonnegative(),
  })
  .openapi("NoticeList");
export type NoticeList = z.infer<typeof NoticeList>;

export const MarkNoticesReadBody = z
  .object({
    /** Marks the notices created at or before this time: the newest one the person saw. */
    upTo: z.iso.datetime(),
  })
  .openapi("MarkNoticesReadBody");
export type MarkNoticesReadBody = z.infer<typeof MarkNoticesReadBody>;
