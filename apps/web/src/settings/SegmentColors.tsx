import {
  DEFAULT_SPONSORBLOCK_COLORS,
  SPONSORBLOCK_COLOR_KEYS,
  type SponsorBlockColorKey,
  type SponsorBlockColors,
} from "@uroboros/contract";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { errorText } from "@/api/client";
import { useUpdatePreferences } from "@/api/preferences";
import { Button } from "@/components/ui/button";
import { SettingsRow } from "@/components/ui/settings-row";
import { notify } from "@/components/ui/sonner";

import { SPONSORBLOCK_LABELS } from "./sponsorBlockLabels";

/** A color picker sends a change at every step of a drag; the last one is saved after this. */
const SAVE_AFTER_MS = 400;

const LABELS: Record<SponsorBlockColorKey, string> = {
  ...SPONSORBLOCK_LABELS,
  poi_highlight: "Highlight",
};

const HIGHLIGHT_LINE =
  "The moment people marked as what the video is for: a mark on the timeline and a Jump to highlight button";

const same = (a: SponsorBlockColors, b: SponsorBlockColors) =>
  SPONSORBLOCK_COLOR_KEYS.every((k) => a[k] === b[k]);

/**
 * The colors part of Settings › SponsorBlock (docs/automation.md#sponsorblock): a native color
 * picker for each category's bands and for the highlight's mark, videos and audio alike, and a way
 * back to SponsorBlock's own. A change shows at once and is saved once the picking stops (or the
 * page is left).
 */
export function SegmentColors({ current }: { current: SponsorBlockColors | undefined }) {
  const { mutate } = useUpdatePreferences();
  /** What the pickers show while a change waits to be saved. */
  const [draft, setDraft] = useState<SponsorBlockColors | null>(null);
  const waiting = useRef<{
    colors: SponsorBlockColors;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const saveRef = useRef<(colors: SponsorBlockColors) => void>(() => undefined);
  useEffect(() => {
    saveRef.current = (colors) => {
      mutate(
        { sponsorBlockColors: colors },
        {
          onError: (error) => {
            notify.error(`Could not save: ${errorText(error)}`);
          },
        },
      );
    };
  }, [mutate]);
  // Leaving the page saves a change still waiting.
  useEffect(
    () => () => {
      const w = waiting.current;
      if (w === null) return;
      clearTimeout(w.timer);
      waiting.current = null;
      saveRef.current(w.colors);
    },
    [],
  );
  const shown = draft ?? current ?? DEFAULT_SPONSORBLOCK_COLORS;
  const flush = () => {
    const w = waiting.current;
    if (w === null) return;
    waiting.current = null;
    saveRef.current(w.colors);
    // The save shows the colors at once (useUpdatePreferences), so the draft can go.
    setDraft(null);
  };
  const pick = (key: SponsorBlockColorKey, value: string) => {
    const next = { ...shown, [key]: value.toLowerCase() };
    setDraft(next);
    if (waiting.current !== null) clearTimeout(waiting.current.timer);
    waiting.current = { colors: next, timer: setTimeout(flush, SAVE_AFTER_MS) };
  };
  const reset = () => {
    if (waiting.current !== null) clearTimeout(waiting.current.timer);
    waiting.current = null;
    setDraft(null);
    saveRef.current(DEFAULT_SPONSORBLOCK_COLORS);
  };
  return (
    <section aria-label="Colors" className="grid gap-1">
      <h3 className="text-sm font-bold">Colors</h3>
      <p className="text-xs text-muted-foreground">
        The colors of the bands and the highlight on the timeline, videos and audio alike.
      </p>
      <div className="mt-2">
        {SPONSORBLOCK_COLOR_KEYS.map((key) => (
          <SettingsRow
            key={key}
            label={LABELS[key]}
            {...(key === "poi_highlight" ? { description: HIGHLIGHT_LINE } : {})}
          >
            <span className="flex items-center gap-3">
              <input
                type="color"
                aria-label={`${LABELS[key]} color`}
                value={shown[key]}
                disabled={current === undefined}
                onChange={(e) => {
                  pick(key, e.target.value);
                }}
                className="h-11 w-14 cursor-pointer rounded-[0.625rem] border border-input bg-transparent p-1 focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none disabled:cursor-default disabled:opacity-45 md:h-9"
              />
              <span className="font-mono text-xs text-muted-foreground">{shown[key]}</span>
            </span>
          </SettingsRow>
        ))}
      </div>
      {same(shown, DEFAULT_SPONSORBLOCK_COLORS) ? null : (
        <Button variant="quiet" size="compact" className="mt-2 w-fit" onClick={reset}>
          <RotateCcw aria-hidden /> Use SponsorBlock&apos;s colors
        </Button>
      )}
    </section>
  );
}
