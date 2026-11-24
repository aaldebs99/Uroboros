import { MAX_LATEST, type BackfillMode } from "@uroboros/contract";
import { LoaderCircle } from "lucide-react";
import { useState, type SyntheticEvent } from "react";

import { useProfiles } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, SelectField } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SettingsGroup, SettingsRow } from "@/components/ui/settings-row";
import { Switch } from "@/components/ui/switch";

import { backfillWarning, type EveryUnit, type FormValues } from "./formValues";

type Set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => void;
interface SectionProps {
  v: FormValues;
  set: Set;
  kind: "channel" | "playlist";
}

const DELAYS = [0, 6, 12, 24, 48, 72] as const;
const PATTERN_HELP = "Postgres regular expression, case-insensitive. \\b works as a word boundary.";

function Check({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      {label}
    </label>
  );
}

function What({ v, set, kind, tabs }: SectionProps & { tabs: string[] }) {
  const profiles = useProfiles().data ?? [];
  const toggle = (name: string, on: boolean) => {
    set(
      "feeds",
      on
        ? tabs.filter((t) => t === name || v.feeds.includes(t))
        : v.feeds.filter((f) => f !== name),
    );
  };
  return (
    <SettingsRow label="What" wide description="Which tabs to follow, in which format.">
      {kind === "channel" ? (
        <div className="flex flex-wrap gap-x-6" role="group" aria-label="Tabs">
          {tabs.map((t) => (
            <Check
              key={t}
              label={t}
              checked={v.feeds.includes(t)}
              disabled={v.feeds.length === 1 && v.feeds.includes(t)}
              onChange={(on) => {
                toggle(t, on);
              }}
            />
          ))}
        </div>
      ) : null}
      <SelectField
        label="Format"
        value={v.profileId}
        onChange={(e) => {
          set("profileId", e.target.value);
        }}
      >
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </SelectField>
    </SettingsRow>
  );
}

/** A radio row: the native control, its label beside it, at a full touch-target height. */
function Choice({
  name,
  label,
  checked,
  onPick,
}: {
  name: string;
  label: string;
  checked: boolean;
  onPick: () => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3">
      <input
        type="radio"
        name={name}
        className="size-4.5 accent-primary"
        checked={checked}
        onChange={onPick}
      />
      {label}
    </label>
  );
}

const UNITS: [EveryUnit, string][] = [
  ["minutes", "Minutes"],
  ["hours", "Hours"],
  ["days", "Days"],
];

/** How often to check: every N minutes, hours or days, or on a cron in the browser's timezone. */
function Schedule({ v, set }: SectionProps) {
  return (
    <fieldset className="grid gap-3">
      <legend className="mb-1 text-sm font-medium">Check for new videos</legend>
      <div className="flex flex-wrap gap-x-6">
        <Choice
          name="schedule"
          label="Every"
          checked={v.scheduleMode === "interval"}
          onPick={() => {
            set("scheduleMode", "interval");
          }}
        />
        <Choice
          name="schedule"
          label="On a cron schedule"
          checked={v.scheduleMode === "cron"}
          onPick={() => {
            set("scheduleMode", "cron");
          }}
        />
      </div>
      {v.scheduleMode === "interval" ? (
        <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,12rem)] gap-3">
          <Field
            label="Check every"
            type="number"
            min={1}
            required
            value={v.everyValue}
            onChange={(e) => {
              set("everyValue", e.target.value);
            }}
          />
          <SelectField
            label="Unit"
            value={v.everyUnit}
            onChange={(e) => {
              set("everyUnit", e.target.value as EveryUnit);
            }}
          >
            {UNITS.map(([unit, label]) => (
              <option key={unit} value={unit}>
                {label}
              </option>
            ))}
          </SelectField>
        </div>
      ) : (
        <Field
          label="Cron schedule"
          mono
          required
          value={v.cron}
          help={`Minute, hour, day of month, month, day of week, in ${v.timezone}. 0 9 * * * checks every day at 09:00; 0 */6 * * * every 6 hours.`}
          onChange={(e) => {
            set("cron", e.target.value);
          }}
        />
      )}
    </fieldset>
  );
}

function When(props: SectionProps) {
  const { v, set } = props;
  return (
    <SettingsRow label="When" wide>
      <Schedule {...props} />
      <SelectField
        label="Wait before downloading"
        help="SponsorBlock segments are submitted in the hours after a video goes up."
        value={String(v.delayHours)}
        onChange={(e) => {
          set("delayHours", Number(e.target.value));
        }}
      >
        {DELAYS.map((h) => (
          <option key={h} value={h}>
            {h === 0 ? "Don't wait" : `${String(h)} hours`}
          </option>
        ))}
      </SelectField>
    </SettingsRow>
  );
}

function Filters({ v, set, kind }: SectionProps) {
  const field = (label: string, key: "titleInclude" | "titleExclude") => (
    <Field
      label={label}
      mono
      help={PATTERN_HELP}
      value={v[key]}
      onChange={(e) => {
        set(key, e.target.value);
      }}
    />
  );
  const minutes = (label: string, key: "minMinutes" | "maxMinutes") => (
    <Field
      label={label}
      type="number"
      min={0}
      inputMode="decimal"
      value={v[key]}
      onChange={(e) => {
        set(key, e.target.value);
      }}
    />
  );
  return (
    <SettingsRow label="Filters" wide description="New videos must pass all of these.">
      {field("Title must match", "titleInclude")}
      {field("Title must not match", "titleExclude")}
      <div className="grid gap-3 sm:grid-cols-2">
        {minutes("At least (minutes)", "minMinutes")}
        {minutes("At most (minutes)", "maxMinutes")}
      </div>
      <Field
        label="Uploaded on or after"
        type="date"
        value={v.uploadedAfter}
        onChange={(e) => {
          set("uploadedAfter", e.target.value);
        }}
      />
      <div className="flex flex-wrap gap-x-6">
        <Check
          label="Exclude live streams"
          checked={v.excludeLive}
          onChange={(on) => {
            set("excludeLive", on);
          }}
        />
        {kind === "playlist" ? (
          <Check
            label="Exclude Shorts"
            checked={v.excludeShorts}
            onChange={(on) => {
              set("excludeShorts", on);
            }}
          />
        ) : null}
      </div>
    </SettingsRow>
  );
}

function Backfill({ v, set, kind }: SectionProps) {
  const choices: [BackfillMode, string][] = [
    ["none", "None, only new uploads"],
    ...(kind === "channel"
      ? ([["newest", `The newest of each tab (up to ${String(MAX_LATEST)})`]] as [
          BackfillMode,
          string,
        ][])
      : []),
    ["all", "All of them"],
  ];
  return (
    <SettingsRow
      label="Download existing videos"
      wide
      description="What's already there when you subscribe. It downloads behind anything you paste."
    >
      <fieldset className="grid gap-1">
        <legend className="sr-only">Download existing videos</legend>
        {choices.map(([mode, label]) => (
          <label key={mode} className="flex min-h-11 items-center gap-3">
            <input
              type="radio"
              name="backfill"
              className="size-4.5 accent-primary"
              checked={v.backfillMode === mode}
              onChange={() => {
                set("backfillMode", mode);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {v.backfillMode === "newest" ? (
        <Field
          label="How many of each tab"
          type="number"
          min={1}
          max={MAX_LATEST}
          value={v.backfillCount}
          onChange={(e) => {
            set("backfillCount", e.target.value);
          }}
        />
      ) : null}
    </SettingsRow>
  );
}

function Retention({ v, set }: SectionProps) {
  const warning = backfillWarning(v);
  return (
    <SettingsRow label="Retention" wide description="Kept videos are never removed.">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Keep only the newest"
          type="number"
          min={1}
          help="Empty keeps them all."
          value={v.keepLast}
          onChange={(e) => {
            set("keepLast", e.target.value);
          }}
        />
        <Field
          label="Remove watched after (days)"
          type="number"
          min={1}
          help="Empty never removes them."
          value={v.deleteWatchedAfterDays}
          onChange={(e) => {
            set("deleteWatchedAfterDays", e.target.value);
          }}
        />
      </div>
      {warning === null ? null : <Notice tone="warning" title={warning} />}
    </SettingsRow>
  );
}

/** The subscription settings, for a new subscription (with its backfill) or an edit. */
export function SubscriptionForm({
  initial,
  kind,
  tabs,
  isNew,
  submitLabel,
  onSubmit,
}: {
  initial: FormValues;
  kind: "channel" | "playlist";
  tabs: string[];
  isNew: boolean;
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
}) {
  const [v, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set: Set = (key, value) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    void onSubmit(v).finally(() => {
      setBusy(false);
    });
  };
  const props = { v, set, kind };
  return (
    <form onSubmit={submit} className="grid gap-4">
      <SettingsGroup title="Settings">
        <What {...props} tabs={tabs} />
        <When {...props} />
        <Filters {...props} />
        {isNew ? <Backfill {...props} /> : null}
        <Retention {...props} />
        <SettingsRow label="Notifications" description="A push when a check finds new videos.">
          <Switch
            aria-label="Notify me about new videos"
            checked={v.notify}
            onCheckedChange={(on) => {
              set("notify", on);
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      <Button type="submit" className="justify-self-end" disabled={busy}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        {submitLabel}
      </Button>
    </form>
  );
}
