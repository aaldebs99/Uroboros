import { ApiErrorCode, Health, Info } from "@uroboros/contract";
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

/**
 * Typed GET against the app's own API. The response is validated with the contract schema, so a
 * server and client that drift apart fail loudly here instead of rendering `undefined`.
 */
export async function getJson<S extends z.ZodType>(
  path: string,
  schema: S,
  init?: RequestInit,
): Promise<z.infer<S>> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    const body = await readErrorBody(res);
    const detail = body ? `${body.code}: ${body.message}` : res.statusText;
    throw new ApiError(
      res.status,
      `GET ${path} failed: ${String(res.status)} ${detail}`.trim(),
      body,
    );
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ApiError(res.status, `GET ${path} returned a body that is not JSON`);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiError(
      res.status,
      `GET ${path} returned an unexpected body: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export const queryKeys = {
  info: ["api", "info"] as const,
  health: ["api", "health"] as const,
};

export function useInfo() {
  return useQuery({
    queryKey: queryKeys.info,
    queryFn: ({ signal }) => getJson("/api/info", Info, { signal }),
  });
}

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => getJson("/api/health", Health, { signal }),
    refetchInterval: 15_000,
  });
}
