import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";

import { ChannelsPage } from "./library/ChannelsPage";
import { PlaylistsPage } from "./library/PlaylistsPage";
import { keepTrail } from "./library/watchOrigin";
import {
  SettingsGroupsPage,
  SettingsLoginsPage,
  SettingsPage,
  SettingsProfilesPage,
  SettingsSponsorBlockPage,
  SettingsTokensPage,
} from "./routes";
import { AccountRoute, AdminGroupsRoute, AdminUsersRoute } from "./routes/account";
import { DownloadsRoute } from "./routes/downloads";
import { GroupRoute } from "./routes/groups";
import { AudioRoute, ChannelRoute, ItemRoute, LibraryRoute, PlaylistRoute } from "./routes/library";
import { RootLayout } from "./routes/root";
import { NewSubscriptionRoute, SubscriptionRoute } from "./routes/subscriptions";
import { SubscriptionsPage } from "./subscriptions/SubscriptionsPage";
import { PublicRoute } from "./routes/public";
import { SharedPlaylistRoute } from "./routes/shared";
import { SharedByMe } from "./sharing/SharedByMe";
import { SharedPage } from "./sharing/SharedPage";

const rootRoute = createRootRoute({ component: RootLayout });

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: LibraryRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/library/audio", component: AudioRoute }),
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
  createRoute({ getParentRoute: () => rootRoute, path: "/s/$code", component: PublicRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: "/shared", component: SharedPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/shared/by-me", component: SharedByMe }),
  // Groups lived under Shared before Settings; notifications already sent still link there.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/shared/groups",
    beforeLoad: () => {
      redirect({ to: "/settings/groups", replace: true, throw: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/shared/groups/$groupId",
    beforeLoad: ({ params }) => {
      redirect({ to: "/settings/groups/$groupId", params, replace: true, throw: true });
    },
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/shared/$shareId",
    component: SharedPlaylistRoute,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/logins",
    component: SettingsLoginsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/profiles",
    component: SettingsProfilesPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/sponsorblock",
    component: SettingsSponsorBlockPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/groups",
    component: SettingsGroupsPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/groups/$groupId",
    component: GroupRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/tokens",
    component: SettingsTokensPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/account", component: AccountRoute }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/users",
    component: AdminUsersRoute,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/admin/groups",
    component: AdminGroupsRoute,
  }),
]);

/**
 * Code-based routes (no file-route codegen). Tests pass a memory history. Its trail is kept, so a
 * watch page's back link finds the page the video was opened from (`library/watchOrigin.ts`).
 */
export function createAppRouter(history: RouterHistory = createBrowserHistory()) {
  return createRouter({ routeTree, history: keepTrail(history) });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
