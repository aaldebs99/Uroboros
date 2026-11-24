import type { NotificationPrefs } from "@uroboros/contract";

import { errorText } from "@/api/client";
import { useNotificationPrefs, useSetNotificationPrefs } from "@/api/push";
import { SettingsRow } from "@/components/ui/settings-row";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";

const KINDS: { key: keyof NotificationPrefs; label: string; description: string }[] = [
  { key: "downloads", label: "Downloads", description: "When a download finishes or fails" },
  {
    key: "shares",
    label: "Shared with me",
    description: "When someone shares a video or playlist with you",
  },
  { key: "groups", label: "Groups", description: "When someone adds you to a group" },
];

/** Which kinds of notification the person gets; each switch saves at once. */
export function NotificationKinds() {
  const prefs = useNotificationPrefs();
  const save = useSetNotificationPrefs();
  if (prefs.isError) return <p className="text-sm text-destructive">{errorText(prefs.error)}</p>;
  const current = prefs.data;
  return (
    <div>
      {KINDS.map((k) => (
        <SettingsRow key={k.key} label={k.label} description={k.description}>
          <Switch
            aria-label={k.label}
            checked={current?.[k.key] ?? true}
            disabled={current === undefined || save.isPending}
            onCheckedChange={(on) => {
              if (current === undefined) return;
              save.mutate(
                { ...current, [k.key]: on },
                {
                  onError: (error) => {
                    notify.error(errorText(error));
                  },
                },
              );
            }}
          />
        </SettingsRow>
      ))}
    </div>
  );
}
