import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import { DownloadsPage, LibraryPage, SettingsPage, SubscriptionsPage } from "./routes";
import { RootLayout } from "./routes/root";

const rootRoute = createRootRoute({ component: RootLayout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: LibraryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/downloads", component: DownloadsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/subscriptions",
    component: SubscriptionsPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
]);

/** Code-based routes (no file-route codegen). Tests pass a memory history. */
export function createAppRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, history });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
