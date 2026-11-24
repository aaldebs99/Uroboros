import { z } from "@hono/zod-openapi";

/** Settings an admin changes for the whole instance, at runtime (docs/mcp.md). */
export const InstanceSettings = z.object({ mcpEnabled: z.boolean() }).openapi("InstanceSettings");
export type InstanceSettings = z.infer<typeof InstanceSettings>;

/** The settings to change; at least one. */
export const InstanceSettingsPatch = z
  .object({ mcpEnabled: z.boolean().optional() })
  .refine((p) => Object.values(p).some((v) => v !== undefined), "nothing to change")
  .openapi("InstanceSettingsPatch");
export type InstanceSettingsPatch = z.infer<typeof InstanceSettingsPatch>;
