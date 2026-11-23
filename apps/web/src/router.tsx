import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import { LibraryPage, SettingsPage, SubscriptionsPage } from "./routes";
import { AccountRoute, AdminUsersRoute } from "./routes/account";
import { DownloadsRoute } from "./routes/downloads";
import { RootLayout } from "./routes/root";

const rootRoute = createRootRoute({ component: RootLayout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: LibraryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/downloads", component: DownloadsRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/subscriptions",
    component: SubscriptionsPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/account", component: AccountRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/users",
    component: AdminUsersRoute,
  }),
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
