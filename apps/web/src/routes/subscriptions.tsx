import { useRouterState } from "@tanstack/react-router";

import { NewSubscriptionPage } from "@/subscriptions/NewSubscriptionPage";
import { SubscriptionPage } from "@/subscriptions/SubscriptionPage";

/** `/subscriptions/<id>`: the id is the path's last segment (code-based routes are untyped here). */
export function SubscriptionRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const id = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
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
