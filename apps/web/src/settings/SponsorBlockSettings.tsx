import {
  SPONSORBLOCK_CATEGORIES,
  type SponsorBlockCategory,
  type SponsorBlockChoice,
  type SponsorBlockSettings as Settings,
} from "@uroboros/contract";
import { useId } from "react";

import { errorText } from "@/api/client";
import { usePreferences, useUpdatePreferences } from "@/api/preferences";
import { SettingsRow } from "@/components/ui/settings-row";
import { notify } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";

import { SPONSORBLOCK_LABELS } from "./sponsorBlockLabels";

/** What each category is, in a line. */
const DESCRIPTIONS: Record<SponsorBlockCategory, string> = {
  sponsor: "Paid promotions and sponsored mentions",
  intro: "Intermissions and intro animations with nothing new in them",
  outro: "End cards, credits and endings with nothing new in them",
  selfpromo: "Unpaid promotion: merch, donations, the creator's other channels",
  preview: "Recaps of earlier episodes and previews of what's coming",
  filler: "Tangents and jokes off the main content",
  interaction: "Reminders to like, subscribe or follow",
  music_offtopic: "The parts of a music video that aren't music",
};

type Kind = "video" | "audio";
const GROUPS: { kind: Kind; title: string; description: string }[] = [
  { kind: "video", title: "Videos", description: "What the player does in a video." },
  { kind: "audio", title: "Audio", description: "What the player does in an audio file." },
];

/** `choice` with `category` turned on or off in `field`, sorted as the server keeps it. */
function toggled(
  choice: SponsorBlockChoice,
  field: "show" | "skip",
  category: SponsorBlockCategory,
  on: boolean,
): SponsorBlockChoice {
  const rest = choice[field].filter((c) => c !== category);
  return { ...choice, [field]: (on ? [...rest, category] : rest).sort() };
}

/** One labelled switch: "Show" or "Skip" beside it, the full name for screen readers. */
function ChoiceSwitch({
  word,
  label,
  checked,
  disabled,
  onChange,
}: {
  word: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <span className="flex min-h-11 items-center gap-2 md:min-h-8">
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <label htmlFor={id} aria-hidden className="text-sm">
        {word}
      </label>
    </span>
  );
}

/**
 * Settings › SponsorBlock (docs/automation.md#sponsorblock): for videos and for audio files apart,
 * which categories' segments the player shows on the timeline (Show) and which it jumps over
 * (Skip), either without the other. Each switch saves at once.
 */
export function SponsorBlockSettings() {
  const prefs = usePreferences();
  const save = useUpdatePreferences();
  if (prefs.isError) return <p className="text-sm text-destructive">{errorText(prefs.error)}</p>;
  const current = prefs.data?.sponsorBlock;
  const change = (kind: Kind, field: "show" | "skip", c: SponsorBlockCategory, on: boolean) => {
    if (current === undefined) return;
    const next: Settings = { ...current, [kind]: toggled(current[kind], field, c, on) };
    save.mutate(
      { sponsorBlock: next },
      {
        onError: (error) => {
          notify.error(`Could not save: ${errorText(error)}`);
        },
      },
    );
  };
  return (
    <div className="grid gap-8">
      {GROUPS.map((g) => (
        <section key={g.kind} aria-label={g.title} className="grid gap-1">
          <h3 className="text-sm font-bold">{g.title}</h3>
          <p className="text-xs text-muted-foreground">{g.description}</p>
          <div className="mt-2">
            {SPONSORBLOCK_CATEGORIES.map((c) => (
              <SettingsRow key={c} label={SPONSORBLOCK_LABELS[c]} description={DESCRIPTIONS[c]}>
                <div className="flex items-center gap-5">
                  {(["show", "skip"] as const).map((field) => (
                    <ChoiceSwitch
                      key={field}
                      word={field === "show" ? "Show" : "Skip"}
                      label={`${g.title}: ${field} ${SPONSORBLOCK_LABELS[c]}`}
                      checked={current?.[g.kind][field].includes(c) ?? false}
                      disabled={current === undefined}
                      onChange={(on) => {
                        change(g.kind, field, c, on);
                      }}
                    />
                  ))}
                </div>
              </SettingsRow>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
