import type { DownloadErrorKind, DownloadRequest } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import { errorText } from "@/api/client";
import { useRequest } from "@/api/downloads";
import { createSubscription, subscriptionKeys } from "@/api/subscriptions";
import { BackLink } from "@/components/ui/back-link";
import { PageHeader } from "@/components/ui/page-header";
import { notify } from "@/components/ui/sonner";
import { DOWNLOAD_ERROR_TEXT } from "@/downloads/errorText";
import { LoginHint } from "@/downloads/LoginHint";
import { YtDlpDetails } from "@/downloads/YtDlpDetails";

import { fromRequest, toCreateBody } from "./formValues";
import { SubscriptionForm } from "./SubscriptionForm";

/** Why a link can't be subscribed to: its check failed (with yt-dlp's words), or it is one video. */
function NotSubscribable({ request }: { request: DownloadRequest }) {
  const kind: DownloadErrorKind =
    request.state === "failed" ? (request.errorKind ?? "unknown") : "not_a_feed";
  return (
    <div className="grid gap-2">
      <p className="text-destructive">{DOWNLOAD_ERROR_TEXT[kind]}</p>
      <LoginHint kind={kind} />
      <YtDlpDetails lines={request.stderrTail} />
    </div>
  );
}

/** The page's frame in every state: the way back to Subscriptions above it. */
export function NewSubscriptionFrame({ children }: { children: ReactNode }) {
  return (
    <section className="grid w-full gap-6">
      <BackLink to="/subscriptions">Subscriptions</BackLink>
      {children}
    </section>
  );
}

/**
 * `/subscriptions/new?request=<id>`: subscribe to the channel or playlist a pasted link shows,
 * waiting here while it is looked at (Subscriptions › Add subscription comes straight here).
 */
export function NewSubscriptionPage({ requestId }: { requestId: string }) {
  const req = useRequest(requestId);
  const client = useQueryClient();
  const navigate = useNavigate();
  const data = req.data;
  if (req.isError) {
    return (
      <NewSubscriptionFrame>
        <p className="text-destructive">{errorText(req.error)}</p>
      </NewSubscriptionFrame>
    );
  }
  if (data === undefined || data.state === "probing") {
    return (
      <NewSubscriptionFrame>
        <p className="flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden /> Looking at the link… a big
          channel can take a minute.
        </p>
      </NewSubscriptionFrame>
    );
  }
  const kind = data.kind;
  if (data.state !== "choosing" || (kind !== "channel" && kind !== "playlist")) {
    return (
      <NewSubscriptionFrame>
        <NotSubscribable request={data} />
      </NewSubscriptionFrame>
    );
  }
  const title = data.title ?? data.url;
  return (
    <NewSubscriptionFrame>
      <PageHeader
        showTitle
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
    </NewSubscriptionFrame>
  );
}
