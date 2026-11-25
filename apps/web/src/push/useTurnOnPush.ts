import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { errorText, queryKeys } from "@/api/client";
import { registerDevice } from "@/api/push";
import { notify } from "@/components/ui/sonner";

import { bodyOf, currentSubscription, deviceLabel, subscribe } from "./browser";
import { markTurnedOffHere, storeDevice } from "./stored";

/**
 * Turns notifications on for this browser: asks for permission (so `turnOn` must run from a tap),
 * subscribes with the server's key and registers the device. A refusal or a failure is a toast;
 * `turnOn` settles true only when this browser is now one of the person's devices.
 */
export function useTurnOnPush(publicKey: string): {
  busy: boolean;
  turnOn: () => Promise<boolean>;
} {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    try {
      const subscription = (await currentSubscription()) ?? (await subscribe(publicKey));
      if (!subscription) {
        notify.info("Notifications weren't allowed, so nothing changed.");
        return false;
      }
      const device = await registerDevice(bodyOf(subscription, deviceLabel()));
      storeDevice({ id: device.id, endpoint: subscription.endpoint });
      markTurnedOffHere(false);
      await client.invalidateQueries({ queryKey: queryKeys.myPush });
      return true;
    } catch (error) {
      notify.error(`Could not turn on notifications: ${errorText(error)}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, turnOn };
}
