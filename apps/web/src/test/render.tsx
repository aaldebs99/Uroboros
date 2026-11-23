import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";

/** Stubs `fetch` with a per-path responder; an unknown path is a network failure. */
export function stubApi(routes: Record<string, () => Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const path =
        typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      const respond = routes[path];
      return respond ? Promise.resolve(respond()) : Promise.reject(new TypeError("fetch failed"));
    }),
  );
}

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/**
 * Like `renderWithQuery`, inside a one-route memory router, for components holding router
 * `Link`s. Awaits the router's first load so the tree is there when it returns.
 */
export async function renderInRouter(ui: ReactElement) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}
