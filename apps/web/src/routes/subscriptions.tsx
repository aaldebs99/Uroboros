import { useRouterState } from "@tanstack/react-router";

import { SubscriptionPage } from "@/subscriptions/SubscriptionPage";

/** `/subscriptions/<id>`: the id is the path's last segment (code-based routes are untyped here). */
export function SubscriptionRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const id = decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? "");
  return <SubscriptionPage subscriptionId={id} />;
}
