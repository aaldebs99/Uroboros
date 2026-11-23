import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";

import { errorText } from "@/api/client";
import { useRequest } from "@/api/downloads";
import { createSubscription, subscriptionKeys } from "@/api/subscriptions";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";

import { fromRequest, toCreateBody } from "./formValues";
import { SubscriptionForm } from "./SubscriptionForm";

/** `/subscriptions/new?request=<id>`: subscribe to the channel or playlist a preview shows. */
export function NewSubscriptionPage({ requestId }: { requestId: string }) {
  const req = useRequest(requestId);
  const client = useQueryClient();
  const navigate = useNavigate();
  const data = req.data;
  if (req.isError) return <p className="text-destructive">{errorText(req.error)}</p>;
  if (data === undefined || data.state === "probing") {
    return (
      <p className="flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden /> Looking at the link…
      </p>
    );
  }
  const kind = data.kind;
  if (data.state !== "choosing" || (kind !== "channel" && kind !== "playlist")) {
    return (
      <p className="text-destructive">Only a channel or playlist link can be subscribed to.</p>
    );
  }
  const title = data.title ?? data.url;
  return (
    <section className="grid w-full gap-6">
      <PageHeader
        title={`Subscribe to ${title}`}
        description="New videos download by themselves; these settings can change later."
      />
      <SubscriptionForm
        initial={fromRequest(data)}
        kind={kind}
        tabs={data.groups.filter((g) => g.url !== null).map((g) => g.name)}
        isNew
        submitLabel="Subscribe"
        onSubmit={async (values) => {
          try {
            const sub = await createSubscription(toCreateBody(values, data.id));
            await client.invalidateQueries({ queryKey: subscriptionKeys.all });
            notify.success(`Subscribed to ${title}.`);
            await navigate({ href: `/subscriptions/${encodeURIComponent(sub.id)}` });
          } catch (err) {
            notify.error(errorText(err));
          }
        }}
      />
    </section>
  );
}
