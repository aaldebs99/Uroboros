import { apiErrorStatus } from "@uroboros/contract";
import type { ApiErrorBody, ApiErrorCode } from "@uroboros/contract";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Logger } from "pino";
import { loggedPath } from "./logPath.ts";

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

/** The code and fixed message for an HTTPException's status; its own message is never shown. */
const HTTP_EXCEPTION: Partial<Record<number, [ApiErrorCode, string]>> = {
  400: ["bad_request", "bad request"],
  401: ["unauthorized", "unauthorized"],
  403: ["forbidden", "forbidden"],
  404: ["not_found", "not found"],
  409: ["conflict", "conflict"],
  413: ["payload_too_large", "request body too large"],
  422: ["unprocessable", "unprocessable request"],
  429: ["too_many_requests", "too many requests"],
  503: ["unavailable", "unavailable"],
};

/** Any other 4xx is the client's fault but has no code of its own: a plain bad_request. */
function fromHttpException(status: number): [ApiErrorCode, string] | null {
  const known = HTTP_EXCEPTION[status];
  if (known !== undefined) return known;
  if (status >= 400 && status < 500) return ["bad_request", "bad request"];
  return null;
}

/**
 * Hono `onError`: ApiError verbatim; an HTTPException (Hono's own, e.g. the body limit's 413) as
 * the code for its status; anything else becomes `internal` with the cause hidden.
 */
export function errorHandler(logger: Logger) {
  return (err: Error, c: Context): Response => {
    if (err instanceof ApiError) return errorResponse(c, err.code, err.message);
    if (err instanceof HTTPException) {
      const mapped = fromHttpException(err.status);
      if (mapped !== null) return errorResponse(c, ...mapped);
    }
    logger.error({ err, path: loggedPath(c.req.path) }, "unhandled error");
    return errorResponse(c, "internal", "internal error");
  };
}
