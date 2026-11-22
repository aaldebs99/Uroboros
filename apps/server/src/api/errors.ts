import { apiErrorStatus } from "@uroboros/contract";
import type { ApiErrorBody, ApiErrorCode } from "@uroboros/contract";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";

/** Thrown from handlers; rendered as an `ApiErrorBody` with the status for its code. */
export class ApiError extends Error {
  override readonly name = "ApiError";
  readonly code: ApiErrorCode;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function errorResponse(c: Context, code: ApiErrorCode, message: string): Response {
  const body: ApiErrorBody = { code, message };
  return c.json(body, apiErrorStatus[code]);
}

/** Hono `onError`: ApiError verbatim, anything else becomes `internal` with the cause hidden. */
export function errorHandler(logger: Logger) {
  return (err: Error, c: Context): Response => {
    if (err instanceof ApiError) return errorResponse(c, err.code, err.message);
    if (err instanceof HTTPException && err.status === 400) {
      return errorResponse(c, "bad_request", "bad request");
    }
    logger.error({ err, path: c.req.path }, "unhandled error");
    return errorResponse(c, "internal", "internal error");
  };
}
