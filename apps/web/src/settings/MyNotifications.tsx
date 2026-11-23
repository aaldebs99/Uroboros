import type { PushDevice, PushTestOutcome, PushView } from "@uroboros/contract";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Loader, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { errorText, queryKeys } from "@/api/client";
import { registerDevice, useDeleteDevice, usePush, useTestPush } from "@/api/push";
import { Button } from "@/components/ui/button";
import { bodyOf, currentSubscription, deviceLabel, pushSupported, subscribe } from "@/push/browser";
import { isInstalled, isIos } from "@/push/installed";
import { markTurnedOffHere, storeDevice, storedDevice, turnedOffHere } from "@/push/stored";

/** What a test notification's outcome means to the person, said as a toast. */
const TEST_SAID: Record<PushTestOutcome, { text: string; ok: boolean }> = {
  delivered: { text: "Sent. It shows on the device in a moment.", ok: true },
  gone: { text: "That device no longer takes notifications, so it was removed.", ok: false },
  failed: { text: "The push service refused it. Try again later.", ok: false },
};

/** Why this browser cannot turn notifications on here, if it cannot. */
function blocker(): string | null {
  if (isIos() && !isInstalled()) {
    return "On iPhone and iPad (iOS 16.4 or later), notifications come to the installed app. In Safari, tap Share, then Add to Home Screen, then open Uroboros from its icon and come back here.";
  }
  if (!pushSupported()) return "This browser can't receive notifications.";
  if (Notification.permission === "denied") {
    return "Notifications are blocked for Uroboros in this browser's settings. Allow them there, then come back here.";
  }
  return null;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const at = (iso: string) => when.format(new Date(iso));

function lastHeard(device: PushDevice): string {
  if (device.failedAt && (!device.lastSuccessAt || device.failedAt > device.lastSuccessAt)) {
    return `last push failed ${at(device.failedAt)}`;
  }
  if (device.lastSuccessAt) return `last push ${at(device.lastSuccessAt)}`;
  return `added ${at(device.createdAt)}`;
}

/** One device: its name, when it was last reached, and its actions. */
function DeviceRow({ device, here }: { device: PushDevice; here: boolean }) {
  const test = useTestPush();
  const remove = useDeleteDevice();
  const sendTest = () => {
    test.mutate(device.id, {
      onSuccess: ({ outcome }) => {
        const said = TEST_SAID[outcome];
        (said.ok ? toast.success : toast.error)(`${device.label}: ${said.text}`);
      },
      onError: (error) => toast.error(`${device.label}: ${errorText(error)}`),
    });
  };
  const turnOff = () => {
    remove.mutate(device.id, {
      onSuccess: () => {
        if (here) storeDevice(null);
      },
      onError: (error) => toast.error(`${device.label}: ${errorText(error)}`),
    });
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Smartphone className="size-4 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">
          {device.label}
          {here ? <span className="font-normal text-muted-foreground"> · this device</span> : null}
        </p>
        <p className="text-sm text-muted-foreground">{lastHeard(device)}</p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={test.isPending}
          aria-label={`Send test to ${device.label}`}
          onClick={sendTest}
        >
          {test.isPending ? "Sending…" : "Send test"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={remove.isPending}
          aria-label={`Turn off ${device.label}`}
          onClick={turnOff}
        >
          Turn off
        </Button>
      </div>
    </li>
  );
}

/** Turns notifications on for this browser, from the tap the permission prompt needs. */
function TurnOn({ publicKey, label }: { publicKey: string; label: string }) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const turnOn = async () => {
    setBusy(true);
    try {
      const subscription = (await currentSubscription()) ?? (await subscribe(publicKey));
      if (!subscription) {
        toast.info("Notifications weren't allowed, so nothing changed.");
        return;
      }
      const device = await registerDevice(bodyOf(subscription, deviceLabel()));
      storeDevice({ id: device.id, endpoint: subscription.endpoint });
      markTurnedOffHere(false);
      await client.invalidateQueries({ queryKey: queryKeys.myPush });
    } catch (error) {
      toast.error(`Could not turn on notifications: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <Button disabled={busy} onClick={() => void turnOn()}>
        {busy ? <Loader className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
        {busy ? "Turning on…" : label}
      </Button>
    </div>
  );
}

/** The section once the devices have loaded. */
function Notifications({ view }: { view: PushView }) {
  if (!view.enabled || view.publicKey === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Notifications are off on this server. An operator turns them on by giving Uroboros its
        public https address (UROBOROS_PUBLIC_BASE_URL).
      </p>
    );
  }
  const stored = storedDevice();
  const hereOn = stored !== null && view.devices.some((device) => device.id === stored.id);
  const blocked = hereOn ? null : blocker();
  const offElsewhere = !hereOn && turnedOffHere();
  return (
    <div className="space-y-4">
      {blocked ? <p className="text-sm">{blocked}</p> : null}
      {offElsewhere && !blocked ? (
        <p className="text-sm text-muted-foreground">Turned off from another device.</p>
      ) : null}
      {!hereOn && !blocked ? (
        <TurnOn
          publicKey={view.publicKey}
          label={offElsewhere ? "Turn on here" : "Turn on notifications"}
        />
      ) : null}
      {view.devices.length > 0 ? (
        <ul aria-label="Devices with notifications" className="divide-y border-y">
          {view.devices.map((device) => (
            <DeviceRow key={device.id} device={device} here={device.id === stored?.id} />
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Up to {view.maxDevices} devices. Turning a device off here stops its notifications.
      </p>
    </div>
  );
}

/**
 * The caller's notifications, pushed to the devices they turned them on for: one tap to turn
 * them on for this browser, and each device's test and off switch.
 */
export function MyNotifications() {
  const push = usePush();
  if (push.isPending) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }
  if (push.isError) {
    return (
      <div className="flex items-center gap-3 text-sm">
        <p>Could not load your notification settings.</p>
        <Button variant="outline" size="sm" onClick={() => void push.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return <Notifications view={push.data} />;
}
