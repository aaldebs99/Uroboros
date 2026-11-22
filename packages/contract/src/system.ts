import { z } from "@hono/zod-openapi";

export const HealthStatus = z.enum(["ok", "degraded"]).openapi("HealthStatus");
export type HealthStatus = z.infer<typeof HealthStatus>;

export const DependencyName = z.enum(["database", "valkey"]).openapi("DependencyName");
export type DependencyName = z.infer<typeof DependencyName>;

export const Health = z
  .object({ status: HealthStatus, failing: z.array(DependencyName) })
  .openapi("Health");
export type Health = z.infer<typeof Health>;

export const Info = z.object({ name: z.literal("uroboros"), version: z.string() }).openapi("Info");
export type Info = z.infer<typeof Info>;
