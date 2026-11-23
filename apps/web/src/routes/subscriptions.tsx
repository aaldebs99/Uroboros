import { getRouteApi, useRouterState } from "@tanstack/react-router";

import { NewSubscriptionPage } from "@/subscriptions/NewSubscriptionPage";
import { SubscriptionPage } from "@/subscriptions/SubscriptionPage";

const subscriptionRoute = getRouteApi("/subscriptions/$subscriptionId");

/**
 * `/subscriptions/<id>`: the id from the route's own params, never the location, which is the next
 * page's while a navigation away is under way. The code-based route tree leaves params untyped
 * (`any`), so the `select` states the parameter's type.
 */
export function SubscriptionRoute() {
  const id = subscriptionRoute.useParams({
    select: (p: { subscriptionId: string }) => p.subscriptionId,
  });
  return <SubscriptionPage subscriptionId={id} />;
}

/** `/subscriptions/new?request=<id>`: the form for the preview of that request. */
export function NewSubscriptionRoute() {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const requestId = new URLSearchParams(searchStr).get("request");
  return requestId === null ? (
    <p className="text-muted-foreground">Paste a channel or playlist link to subscribe to it.</p>
  ) : (
    <NewSubscriptionPage requestId={requestId} />
  );
}
