import { ApiErrorCode, Info, Readiness } from "@uroboros/contract";
import type { ApiErrorBody } from "@uroboros/contract";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";

/** Narrows parsed JSON to the contract's `ApiErrorBody`. Anything else is not one. */
function asApiErrorBody(value: unknown): ApiErrorBody | null {
  if (typeof value !== "object" || value === null) return null;
  const { code, message } = value as Record<string, unknown>;
  return isApiErrorCode(code) && typeof message === "string" ? { code, message } : null;
}

/**
 * Exhaustive by construction: the list comes from the contract enum, so a new code is accepted
 * here the moment the contract has it.
 */
function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === "string" && (ApiErrorCode.options as readonly string[]).includes(value);
}

/** Reads a failed response's body as an `ApiErrorBody`, tolerating non-JSON. */
async function readErrorBody(res: Response): Promise<ApiErrorBody | null> {
  try {
    return asApiErrorBody(JSON.parse(await res.text()));
  } catch {
    return null;
  }
}

/**
 * Failed request to the API. `body` is the server's typed error when the response carried one, and
 * `null` when it did not (a proxy error page, a gateway timeout, a 2xx body that failed schema
 * validation), so callers can branch on `code`.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;

  constructor(status: number, message: string, body: ApiErrorBody | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /** The server's error code, if the response carried an `ApiErrorBody`. */
  get code(): ApiErrorCode | null {
    return this.body?.code ?? null;
  }
}

async function parseBody<S extends z.ZodType>(
  res: Response,
  label: string,
  schema: S,
): Promise<z.infer<S>> {
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(res.status, `${label} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(res.status, `${label} returned an unexpected body: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Sends a request to the app's own API, asking for JSON. */
async function request(method: string, path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return fetch(path, { ...init, method, headers });
}

/** The `ApiError` for a failed response, with the server's typed body when it sent one. */
async function failureOf(method: string, path: string, res: Response): Promise<ApiError> {
  const body = await readErrorBody(res);
  const detail = body ? `${body.code}: ${body.message}` : res.statusText;
  return new ApiError(
    res.status,
    `${method} ${path} failed: ${String(res.status)} ${detail}`.trim(),
    body,
  );
}

/** Sends a request to the app's own API and throws an `ApiError` for anything but a 2xx. */
async function send(method: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await request(method, path, init);
  if (!res.ok) throw await failureOf(method, path, res);
  return res;
}

/**
 * `GET /api/ready`. A replica still starting answers 503 with a `starting` report, so the body is
 * read on 503 as on 200; anything else that is not a 2xx throws an `ApiError`.
 */
export async function getReadiness(init?: RequestInit): Promise<Readiness> {
  const res = await request("GET", "/api/ready", init);
  if (!res.ok && res.status !== 503) throw await failureOf("GET", "/api/ready", res);
  return parseBody(res, "GET /api/ready", Readiness);
}

/**
 * Typed GET against the app's own API. The response is validated with the contract schema, so a
 * server and client that drift apart fail loudly here instead of rendering `undefined`.
 */
export async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  return parseBody(await send("GET", path, init), `GET ${path}`, schema);
}

/** Typed POST: `body`, when given, is sent as JSON; the answer is validated like `getJson`'s. */
export async function postJson<S extends z.ZodType>(
  path: string,
  schema: S,
  body?: unknown,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const headers = new Headers(init?.headers);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const res = await send("POST", path, {
    ...init,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parseBody(res, `POST ${path}`, schema);
}

/** DELETE that expects no body back (204). */
export async function deleteJson(path: string, init?: RequestInit): Promise<void> {
  const res = await send("DELETE", path, init);
  await res.body?.cancel();
}

/**
 * What to tell a person about a failed call. Exhaustive over `ApiErrorCode`, so a new code fails
 * `tsc` here until it is decided whether its message is fit to show.
 */
const ERROR_TEXT: Record<ApiErrorCode, (message: string) => string> = {
  bad_request: (message) => message,
  unauthorized: () => "You are not signed in.",
  forbidden: () => "You are not allowed to do that.",
  not_found: (message) => message,
  conflict: (message) => message,
  payload_too_large: () => "That is more than the server accepts in one request.",
  unprocessable: (message) => message,
  too_many_requests: () => "Too many attempts. Wait a few minutes and try again.",
  internal: () => "The server failed. Try again later.",
  unavailable: () => "The server is not ready. Try again in a moment.",
};

export function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    return error.body
      ? ERROR_TEXT[error.body.code](error.body.message)
      : "The server answered oddly.";
  }
  return "Could not reach the server.";
}

export const queryKeys = {
  info: ["api", "info"] as const,
  readiness: ["api", "ready"] as const,
  myPush: ["api", "me", "push"] as const,
};

export function useInfo() {
  return useQuery({
    queryKey: queryKeys.info,
    queryFn: ({ signal }) => getJson("/api/info", Info, { signal }),
  });
}

export function useReadiness() {
  return useQuery({
    queryKey: queryKeys.readiness,
    queryFn: ({ signal }) => getReadiness({ signal }),
    refetchInterval: 15_000,
  });
}
