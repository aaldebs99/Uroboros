import { z } from "@hono/zod-openapi";

/** `GET /api/health`, liveness: a process that answers is alive; no dependency is checked. */
export const Liveness = z.object({ status: z.literal("ok") }).openapi("Liveness");
export type Liveness = z.infer<typeof Liveness>;

/**
 * `ok` and `degraded` once the replica has migrated and attached its database (both 200: a
 * dependency blip keeps it ready); `starting` (503) before that.
 */
export const ReadinessStatus = z.enum(["ok", "degraded", "starting"]).openapi("ReadinessStatus");
export type ReadinessStatus = z.infer<typeof ReadinessStatus>;

export const DependencyName = z.enum(["database", "valkey"]).openapi("DependencyName");
export type DependencyName = z.infer<typeof DependencyName>;

/** `GET /api/ready`: whether this replica takes traffic, and which dependencies fail. */
export const Readiness = z
  .object({ status: ReadinessStatus, failing: z.array(DependencyName) })
  .openapi("Readiness");
export type Readiness = z.infer<typeof Readiness>;

export const Info = z
  .object({
    name: z.literal("uroboros"),
    version: z.string(),
    /** `UROBOROS_PUBLIC_BASE_URL`, when set: the origin public links are copied with. */
    publicBaseUrl: z.string().nullable(),
  })
  .openapi("Info");
export type Info = z.infer<typeof Info>;
