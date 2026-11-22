import { z } from "@hono/zod-openapi";

export const ApiErrorCode = z
  .enum([
    "bad_request",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "payload_too_large",
    "unprocessable",
    "internal",
    "unavailable",
  ])
  .openapi("ApiErrorCode");
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorBody = z
  .object({ code: ApiErrorCode, message: z.string() })
  .openapi("ApiErrorBody");
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

export const apiErrorStatus: Record<
  ApiErrorCode,
  400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503
> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  internal: 500,
  unavailable: 503,
};
