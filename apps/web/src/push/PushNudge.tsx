import { BellRing, Loader } from "lucide-react";
import { useState } from "react";

import { usePush } from "@/api/push";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { notify } from "@/components/ui/sonner";

import { pushSupported } from "./browser";
import { isInstalled } from "./installed";
import { markPushAsked, pushAsked } from "./stored";
import { useTurnOnPush } from "./useTurnOnPush";

/** The offer itself: Turn on asks the browser (from the tap it needs); either button ends it. */
function Offer({ publicKey, onDone }: { publicKey: string; onDone: () => void }) {
  const { busy, turnOn } = useTurnOnPush(publicKey);
  return (
    <Notice
      className="mb-6"
      title="Get notified when downloads finish"
      actions={
        <>
          <Button
            disabled={busy}
            onClick={() => {
              markPushAsked();
              void turnOn().then((on) => {
                if (on) notify.success("Notifications are on for this device.");
                onDone();
              });
            }}
          >
            {busy ? <Loader className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
            {busy ? "Turning on…" : "Turn on"}
          </Button>
          <Button variant="quiet" disabled={busy} onClick={onDone}>
            Not now
          </Button>
        </>
      }
    >
      Turn on notifications for this device. You can change this any time in Settings ›
      Notifications.
    </Notice>
  );
}

/**
 * The installed app's one offer of notifications (docs/push.md): shown above the page while this
 * device hasn't decided (the browser's permission is still "default"), the server pushes, and the
 * offer wasn't answered here before. Browsers ask for permission only from a tap, so this is an
 * in-app banner whose Turn on asks; Turn on or Not now ends it for good on this device.
 */
export function PushNudge() {
  const push = usePush();
  const [asked, setAsked] = useState(pushAsked);
  const view = push.data;
  // Read each render: turning notifications on in Settings meanwhile settles the permission.
  const undecided = pushSupported() && isInstalled() && Notification.permission === "default";
  if (asked || !undecided || !view?.enabled || view.publicKey === null) return null;
  return (
    <Offer
      publicKey={view.publicKey}
      onDone={() => {
        markPushAsked();
        setAsked(true);
      }}
    />
  );
}
