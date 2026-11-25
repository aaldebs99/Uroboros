import type { PushDevice, PushTestOutcome, PushView } from "@uroboros/contract";
import { BellRing, Loader, Smartphone } from "lucide-react";
import { useId } from "react";

import { errorText } from "@/api/client";
import { useDeleteDevice, usePush, useTestPush } from "@/api/push";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { notify } from "@/components/ui/sonner";
import { pushSupported } from "@/push/browser";
import { isInstalled, isIos } from "@/push/installed";
import { storeDevice, storedDevice, turnedOffHere } from "@/push/stored";
import { useTurnOnPush } from "@/push/useTurnOnPush";

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
        (said.ok ? notify.success : notify.error)(`${device.label}: ${said.text}`);
      },
      onError: (error) => {
        notify.error(`${device.label}: ${errorText(error)}`);
      },
    });
  };
  const turnOff = () => {
    remove.mutate(device.id, {
      onSuccess: () => {
        if (here) storeDevice(null);
      },
      onError: (error) => {
        notify.error(`${device.label}: ${errorText(error)}`);
      },
    });
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Smartphone className="size-4.5 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">
          {device.label}
          {here ? <span className="font-normal text-muted-foreground"> · this device</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">{lastHeard(device)}</p>
      </div>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="compact"
          disabled={test.isPending}
          aria-label={`Send test to ${device.label}`}
          onClick={sendTest}
        >
          {test.isPending ? "Sending…" : "Send test"}
        </Button>
        <Button
          variant="destructive"
          size="compact"
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

/**
 * The turn-on button. It is always there while this browser isn't on: when it can't work (push off
 * on the server, or a blocker) it is disabled and described by the reason beside it.
 */
function TurnOnButton({
  label,
  busy = false,
  disabled = false,
  describedBy,
  onClick,
}: {
  label: string;
  busy?: boolean;
  disabled?: boolean;
  describedBy?: string;
  onClick?: () => void;
}) {
  return (
    <div>
      <Button disabled={disabled || busy} aria-describedby={describedBy} onClick={onClick}>
        {busy ? <Loader className="animate-spin" aria-hidden /> : <BellRing aria-hidden />}
        {busy ? "Turning on…" : label}
      </Button>
    </div>
  );
}

/** Turns notifications on for this browser, from the tap the permission prompt needs. */
function TurnOn({ publicKey, label }: { publicKey: string; label: string }) {
  const { busy, turnOn } = useTurnOnPush(publicKey);
  return <TurnOnButton label={label} busy={busy} onClick={() => void turnOn()} />;
}

/** The section once the devices have loaded. */
function Notifications({ view }: { view: PushView }) {
  const reason = useId();
  if (!view.enabled || view.publicKey === null) {
    return (
      <div className="space-y-4">
        <p id={reason} className="text-muted-foreground">
          Notifications are off on this server. An operator turns them on by giving Uroboros its
          public https address (UROBOROS_PUBLIC_BASE_URL).
        </p>
        <TurnOnButton label="Turn on notifications" disabled describedBy={reason} />
      </div>
    );
  }
  const stored = storedDevice();
  const hereOn = stored !== null && view.devices.some((device) => device.id === stored.id);
  const blocked = hereOn ? null : blocker();
  const offElsewhere = !hereOn && turnedOffHere();
  const label = offElsewhere ? "Turn on here" : "Turn on notifications";
  return (
    <div className="space-y-4">
      {blocked ? (
        <Notice id={reason} tone="warning" title="Notifications can't turn on here">
          {blocked}
        </Notice>
      ) : null}
      {offElsewhere && !blocked ? (
        <p className="text-muted-foreground">Turned off from another device.</p>
      ) : null}
      {hereOn ? null : blocked ? (
        <TurnOnButton label={label} disabled describedBy={reason} />
      ) : (
        <TurnOn publicKey={view.publicKey} label={label} />
      )}
      {view.devices.length > 0 ? (
        <ul
          aria-label="Devices with notifications"
          className="divide-y divide-border border-y border-border"
        >
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
        <Button variant="secondary" size="compact" onClick={() => void push.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  return <Notifications view={push.data} />;
}
