import { deleteJson } from "@/api/client";

import { pushSupported } from "./browser";
import { markTurnedOffHere, storeDevice, storedDevice } from "./stored";

/** Sign-out waits this long at most for the push cleanup; leaving must never hang on it. */
const LEAVE_BUDGET_MS = 3000;

async function forget(): Promise<void> {
  const device = storedDevice();
  if (device) {
    try {
      await deleteJson(`/api/me/push/devices/${encodeURIComponent(device.id)}`);
    } catch {
      // Already gone, or the server is unreachable: the browser side below still stops the pushes.
    }
  }
  storeDevice(null);
  markTurnedOffHere(false);
  if (!pushSupported()) return;
  try {
    // getRegistration, not `ready`: `ready` never settles where no service worker is registered.
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  } catch {
    // Nothing more this browser can do.
  }
}

/**
 * Before signing out: stop this browser being one of the leaving person's push devices, so a shared
 * browser neither keeps pushing to them nor blocks the next person from turning notifications on.
 * Best effort, and bounded by `LEAVE_BUDGET_MS`.
 */
export async function forgetThisDevice(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    forget(),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, LEAVE_BUDGET_MS);
    }),
  ]);
  clearTimeout(timer);
}
