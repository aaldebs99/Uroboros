import type { FormatProfile, NewFormatProfileBody, VideoCodec } from "@uroboros/contract";
import { ChevronRight } from "lucide-react";
import { useState, type ChangeEvent, type ReactNode, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, SelectField } from "@/components/ui/field";

import {
  AUDIO_FORMATS,
  CODECS,
  CONTAINERS,
  QUALITIES,
  WEBM_CODECS,
  audioSelectorFor,
  isStandardAudioSelector,
  qualityOf,
  selectorFor,
  type Choice,
  type Quality,
} from "./profileShape";

/** Splits "--a b\n--c" into arguments on whitespace. */
const splitArgs = (text: string): string[] => text.split(/\s+/).filter((t) => t !== "");

/** The list, with `value` added as it is when the list lacks it (a value set before, kept). */
function withValue(list: readonly Choice<string>[], value: string): readonly Choice<string>[] {
  return value === "" || list.some((c) => c.value === value)
    ? list
    : [...list, { value, label: value }];
}

/** A dropdown of `choices`, each disabled when `off` says so. */
function ChoiceField(p: {
  id: string;
  label: string;
  help?: string;
  value: string;
  choices: readonly Choice<string>[];
  off?: (value: string) => boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <SelectField
      id={p.id}
      label={p.label}
      help={p.help}
      value={p.value}
      disabled={p.disabled}
      onChange={(e) => {
        p.onChange(e.target.value);
      }}
    >
      {p.choices.map((c) => (
        <option key={c.value} value={c.value} disabled={p.off?.(c.value) ?? false}>
          {c.label}
        </option>
      ))}
    </SelectField>
  );
}

/** The selector written by hand under Advanced, if the profile's isn't one the choices write. */
function customSelector(p: FormatProfile | undefined): string {
  if (p === undefined) return "";
  const standard = p.audioOnly
    ? isStandardAudioSelector(p.format, p.audioFormat ?? "")
    : qualityOf(p.format) !== null;
  return standard ? "" : p.format;
}

/** Advanced: yt-dlp's own selector and arguments, folded away unless the profile uses them. */
function Advanced({ open, children }: { open: boolean; children: ReactNode }) {
  const [shown, setShown] = useState(open);
  return (
    <details
      open={shown}
      onToggle={(e) => {
        setShown(e.currentTarget.open);
      }}
      className="group grid gap-3.5"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[0.625rem] text-sm font-medium focus-visible:ring-[0.1875rem] focus-visible:ring-ring/45 focus-visible:outline-none">
        <ChevronRight className="size-4.5 transition-transform group-open:rotate-90" aria-hidden />
        Advanced
      </summary>
      <div className="grid gap-3.5 pt-1">{children}</div>
    </details>
  );
}

/** What the form holds: the profile's plain choices, and Advanced's selector and arguments. */
interface Choices {
  name: string;
  /** A selector written by hand, used in place of the quality or audio format when set. */
  custom: string;
  quality: Quality;
  videoCodec: VideoCodec | "";
  container: string;
  audioOnly: boolean;
  audioFormat: string;
  extra: string;
}

/** The choices a profile starts the form with; a new one's when there is none. */
function startingChoices(p: FormatProfile | undefined): Choices {
  return {
    name: p?.name ?? "",
    custom: customSelector(p),
    quality: (p === undefined ? null : qualityOf(p.format)) ?? "best",
    videoCodec: p?.videoCodec ?? "",
    container: p?.mergeFormat ?? "",
    audioOnly: p?.audioOnly ?? false,
    audioFormat: p?.audioFormat ?? "opus",
    extra: p?.extraArgs.join(" ") ?? "",
  };
}

/** The profile the choices make: the selector they write, unless one was written by hand. */
function bodyOf(c: Choices): NewFormatProfileBody {
  const written = c.audioOnly ? audioSelectorFor(c.audioFormat) : selectorFor(c.quality);
  return {
    name: c.name.trim(),
    format: c.custom.trim() === "" ? written : c.custom.trim(),
    mergeFormat: c.audioOnly || c.container === "" ? null : c.container,
    videoCodec: c.audioOnly || c.videoCodec === "" ? null : c.videoCodec,
    audioOnly: c.audioOnly,
    audioFormat: c.audioOnly ? c.audioFormat : null,
    extraArgs: splitArgs(c.extra),
  };
}

/** Whether a codec and a container can't go together: WebM holds AV1 and VP9 alone. */
const clash = (codec: string, container: string) =>
  container === "webm" && codec !== "" && !WEBM_CODECS.has(codec);

/** A video's quality, codec and container; the quality stands aside for a hand-written selector. */
function VideoChoices({ c, set }: { c: Choices; set: (patch: Partial<Choices>) => void }) {
  const handWritten = c.custom.trim() !== "";
  return (
    <>
      <ChoiceField
        id="profile-quality"
        label="Quality"
        value={handWritten ? "custom" : c.quality}
        choices={handWritten ? [{ value: "custom", label: "Custom (advanced)" }] : QUALITIES}
        disabled={handWritten}
        onChange={(v) => {
          set({ quality: v as Quality });
        }}
      />
      <ChoiceField
        id="profile-codec"
        label="Video codec"
        help="Preferred among copies of the same resolution"
        value={c.videoCodec}
        choices={CODECS}
        off={(v) => clash(v, c.container)}
        onChange={(v) => {
          set({ videoCodec: v as VideoCodec | "" });
        }}
      />
      <ChoiceField
        id="profile-container"
        label="Container"
        value={c.container}
        choices={withValue(CONTAINERS, c.container)}
        off={(v) => clash(c.videoCodec, v)}
        onChange={(v) => {
          set({ container: v });
        }}
      />
    </>
  );
}

/**
 * Add or edit a format profile in plain choices: a video's quality, codec and container, or an
 * audio format; yt-dlp's own selector and extra arguments under Advanced, a selector there taking
 * the place of the choices. The server checks the extra arguments against its allowlist.
 */
export function ProfileForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: FormatProfile;
  onSave: (body: NewFormatProfileBody) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [c, setChoices] = useState(() => startingChoices(initial));
  const set = (patch: Partial<Choices>) => {
    setChoices((was) => ({ ...was, ...patch }));
  };
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await onSave(bodyOf(c));
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const text = (key: "name" | "custom" | "extra") => ({
    value: c[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      set({ [key]: e.target.value });
    },
  });
  return (
    <form className="grid gap-3.5" onSubmit={(e) => void submit(e)}>
      <Field id="profile-name" label="Name" {...text("name")} />
      <label className="flex min-h-8 items-center gap-3">
        <Checkbox
          checked={c.audioOnly}
          onChange={(e) => {
            set({ audioOnly: e.target.checked });
          }}
        />
        Audio only
      </label>
      {c.audioOnly ? (
        <ChoiceField
          id="profile-audio"
          label="Audio format"
          value={c.audioFormat}
          choices={withValue(AUDIO_FORMATS, c.audioFormat)}
          onChange={(v) => {
            set({ audioFormat: v });
          }}
        />
      ) : (
        <VideoChoices c={c} set={set} />
      )}
      <Advanced open={c.custom.trim() !== "" || c.extra !== ""}>
        <Field
          id="profile-format"
          label="Format selector"
          mono
          help="yt-dlp's -f, used in place of the choices above when set"
          {...text("custom")}
        />
        <Field
          id="profile-extra"
          label="Extra yt-dlp arguments"
          mono
          help="From the allowlist, e.g. --embed-chapters"
          {...text("extra")}
        />
      </Advanced>
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * The profile form in a dialog, titled `title`: empty when adding, or filled from `initial` (the
 * profile being edited, or a copy of a built-in under its new name).
 */
export function ProfileDialog({
  open,
  title,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  title: string;
  initial?: FormatProfile;
  onSave: (body: NewFormatProfileBody) => Promise<unknown>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-3rem)] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>A yt-dlp preset to download with. Only you see it.</DialogDescription>
        <ProfileForm
          {...(initial === undefined ? {} : { initial })}
          onSave={onSave}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
