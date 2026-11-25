import { Field, SelectField } from "@/components/ui/field";
import { SettingsRow } from "@/components/ui/settings-row";

import type { EveryUnit, SectionProps } from "./formValues";

const DELAYS = [0, 6, 12, 24, 48, 72] as const;

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

/**
 * How often to check: every N minutes, hours or days, on a cron in the browser's timezone, or
 * manually (only Check now, after the one check that takes stock when subscribing).
 */
function Schedule({ v, set, isNew }: SectionProps & { isNew: boolean }) {
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
        <Choice
          name="schedule"
          label="Manually"
          checked={v.scheduleMode === "manual"}
          onPick={() => {
            set("scheduleMode", "manual");
          }}
        />
      </div>
      {v.scheduleMode === "manual" ? (
        <p className="text-xs text-muted-foreground">
          {isNew
            ? "Only when you press Check now. It takes stock once when you subscribe."
            : "Only when you press Check now."}
        </p>
      ) : v.scheduleMode === "interval" ? (
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

/** When to check, and (with auto-download) how long to wait before downloading. */
export function When(props: SectionProps & { isNew: boolean }) {
  const { v, set } = props;
  return (
    <SettingsRow label="When" wide>
      <Schedule {...props} />
      {/* A video someone picks by hand downloads when they pick it: the wait is auto-download's. */}
      {v.autoDownload ? (
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
      ) : null}
    </SettingsRow>
  );
}
