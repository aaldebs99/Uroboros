import { z } from "@hono/zod-openapi";

/** The longest device label the server keeps; a longer one is cut, not refused. */
export const PUSH_LABEL_CHARS = 64;

export const PushDeviceId = z.uuid().openapi("PushDeviceId");
export type PushDeviceId = z.infer<typeof PushDeviceId>;

/** One browser that takes the caller's notifications. Times are ISO 8601. */
export const PushDevice = z
  .object({
    id: PushDeviceId,
    label: z.string(),
    createdAt: z.iso.datetime(),
    lastSuccessAt: z.iso.datetime().nullable(),
    failedAt: z.iso.datetime().nullable(),
  })
  .openapi("PushDevice");
export type PushDevice = z.infer<typeof PushDevice>;

/** Whether this server pushes, the VAPID key browsers subscribe with, and the caller's devices. */
export const PushView = z
  .object({
    enabled: z.boolean(),
    /** base64url, uncompressed P-256; null while push is off. */
    publicKey: z.string().nullable(),
    devices: z.array(PushDevice),
    maxDevices: z.number().int().positive(),
  })
  .openapi("PushView");
export type PushView = z.infer<typeof PushView>;

/** A browser's `PushSubscription.toJSON()`, flattened, plus a name to know it by. */
export const PushSubscriptionBody = z
  .object({
    endpoint: z.string().min(1).max(2048),
    /** base64url P-256 public key of the browser. */
    p256dh: z.string().min(1).max(256),
    /** base64url 16-byte auth secret of the browser. */
    auth: z.string().min(1).max(256),
    label: z.string().max(512),
  })
  .openapi("PushSubscriptionBody");
export type PushSubscriptionBody = z.infer<typeof PushSubscriptionBody>;

export const PushTestOutcome = z.enum(["delivered", "gone", "failed"]).openapi("PushTestOutcome");
export type PushTestOutcome = z.infer<typeof PushTestOutcome>;

export const PushTestResult = z.object({ outcome: PushTestOutcome }).openapi("PushTestResult");
export type PushTestResult = z.infer<typeof PushTestResult>;

/** Whether this browser's endpoint is one of the caller's devices, or was turned off from another device. */
export const PushEndpointStatus = z
  .object({ known: z.boolean(), turnedOffElsewhere: z.boolean() })
  .openapi("PushEndpointStatus");
export type PushEndpointStatus = z.infer<typeof PushEndpointStatus>;

/** Which kinds of push notification a person gets (docs/sharing.md); all of them by default. */
export const NotificationPrefs = z
  .object({ downloads: z.boolean(), shares: z.boolean(), groups: z.boolean() })
  .openapi("NotificationPrefs");
export type NotificationPrefs = z.infer<typeof NotificationPrefs>;
