import type { PushView } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { queryKeys } from "@/api/client";
import { endpointStatus, registerDevice, usePush } from "@/api/push";

import { bodyOf, currentSubscription, deviceLabel, pushSupported, subscribeWith } from "./browser";
import { markTurnedOffHere, storeDevice, storedDevice } from "./stored";
import { syncAction } from "./sync";

/** Mends this browser's notifications as `syncAction` says; true when it registered a device. */
async function mend(view: PushView, publicKey: string): Promise<boolean> {
  let subscription = await currentSubscription();
  const stored = storedDevice();
  const serverDevices = view.devices.map((device) => device.id);
  const endpoint = subscription?.endpoint ?? null;
  // Only a device the server no longer lists needs asking why: forgotten, or turned off elsewhere.
  const forgotten =
    stored !== null && endpoint === stored.endpoint && !serverDevices.includes(stored.id);
  const turnedOffElsewhere =
    forgotten && (await endpointStatus(stored.endpoint)).turnedOffElsewhere;
  const action = syncAction({
    permission: Notification.permission,
    endpoint,
    stored,
    serverDevices,
    turnedOffElsewhere,
  });
  if (action === "none") return false;
  if (action === "forget" || action === "turnedOff") {
    storeDevice(null);
    markTurnedOffHere(action === "turnedOff");
    return false;
  }
  if (action === "resubscribe" || subscription === null) {
    subscription = await subscribeWith(publicKey);
  }
  const device = await registerDevice(bodyOf(subscription, deviceLabel()));
  storeDevice({ id: device.id, endpoint: subscription.endpoint });
  markTurnedOffHere(false);
  return true;
}

/**
 * Once per launch, mends this browser's notifications. Subscriptions vanish without notice (iOS
 * drops them, a reinstall makes a new one), so this subscribes again while permission stands,
 * registers again when the server forgot the device, and forgets it once permission is withdrawn.
 * It never asks for permission: that needs a tap, in Settings.
 */
export function usePushSync(): void {
  const push = usePush();
  const client = useQueryClient();
  const synced = useRef(false);
  const view = push.data;

  useEffect(() => {
    if (!view?.enabled || view.publicKey === null || synced.current || !pushSupported()) return;
    synced.current = true;
    mend(view, view.publicKey).then(
      (registered) => {
        if (registered) void client.invalidateQueries({ queryKey: queryKeys.myPush });
      },
      () => {
        // Best effort: Settings shows the device's state and the way to turn it on again.
      },
    );
  }, [view, client]);
}
