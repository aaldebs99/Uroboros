import { createRoute } from "@hono/zod-openapi";
import { ApiErrorBody, Info } from "@uroboros/contract";

export const infoRoute = createRoute({
  method: "get",
  path: "/api/info",
  security: [],
  summary: "Service name and version",
  responses: {
    200: { description: "Service info", content: { "application/json": { schema: Info } } },
    500: {
      description: "Unexpected error",
      content: { "application/json": { schema: ApiErrorBody } },
    },
  },
});
