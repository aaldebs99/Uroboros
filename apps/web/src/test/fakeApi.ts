import { vi } from "vitest";

export type Handler = (init: RequestInit | undefined, url: URL) => Response | Promise<Response>;

/** Stubs fetch with `"METHOD /path"` handlers; records every call. Unknown routes 404. */
export function fakeApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, "http://app.test");
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      calls.push({ method, path: url.pathname, body });
      const handler = routes[`${method} ${url.pathname}`];
      return handler
        ? handler(init, url)
        : Response.json({ code: "not_found", message: "not found" }, { status: 404 });
    }),
  );
  return calls;
}
