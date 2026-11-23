import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";

import { ChannelsPage } from "./library/ChannelsPage";
import { PlaylistsPage } from "./library/PlaylistsPage";
import { SettingsPage } from "./routes";
import { AccountRoute, AdminProfilesRoute, AdminUsersRoute } from "./routes/account";
import { DownloadsRoute } from "./routes/downloads";
import { ChannelRoute, ItemRoute, LibraryRoute, PlaylistRoute } from "./routes/library";
import { RootLayout } from "./routes/root";
import { NewSubscriptionRoute, SubscriptionRoute } from "./routes/subscriptions";
import { SubscriptionsPage } from "./subscriptions/SubscriptionsPage";

const rootRoute = createRootRoute({ component: RootLayout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: LibraryRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/channels",
    component: ChannelsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/channels/$channelKey",
    component: ChannelRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/playlists",
    component: PlaylistsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/playlists/$playlistId",
    component: PlaylistRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/library/$entryId", component: ItemRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/downloads", component: DownloadsRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/subscriptions",
    component: SubscriptionsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/subscriptions/new",
    component: NewSubscriptionRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/subscriptions/$subscriptionId",
    component: SubscriptionRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/account", component: AccountRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/users",
    component: AdminUsersRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/format-profiles",
    component: AdminProfilesRoute,
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
