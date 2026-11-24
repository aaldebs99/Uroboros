import {
  SPONSORBLOCK_CATEGORIES,
  type FormatProfile,
  type NewFormatProfileBody,
  type SponsorBlockCategory,
} from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";

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
import { Field } from "@/components/ui/field";

const SPONSORBLOCK_LABELS: Record<SponsorBlockCategory, string> = {
  sponsor: "Sponsor",
  intro: "Intro",
  outro: "Outro",
  selfpromo: "Self-promotion",
  preview: "Preview",
  filler: "Filler",
  interaction: "Interaction reminder",
  music_offtopic: "Non-music section",
};

/** What a new profile skips until its owner changes it: the same as the built-in profiles. */
const NEW_PROFILE_CUTS: readonly SponsorBlockCategory[] = ["sponsor", "selfpromo", "interaction"];

/**
 * The SponsorBlock categories a profile gets rid of, as checkboxes: a video keeps them (marked as
 * chapters) for the player to skip, an audio file has them cut out (docs/automation.md#sponsorblock).
 */
function SponsorBlockFields({
  value,
  onChange,
}: {
  value: ReadonlySet<SponsorBlockCategory>;
  onChange: (next: Set<SponsorBlockCategory>) => void;
}) {
  return (
    <fieldset className="grid gap-1" aria-describedby="profile-sponsorblock-help">
      <legend className="mb-1 font-medium">Skip SponsorBlock segments</legend>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {SPONSORBLOCK_CATEGORIES.map((c) => (
          <label key={c} className="flex min-h-11 items-center gap-3">
            <Checkbox
              checked={value.has(c)}
              onChange={(e) => {
                const next = new Set(value);
                if (e.target.checked) next.add(c);
                else next.delete(c);
                onChange(next);
              }}
            />
            {SPONSORBLOCK_LABELS[c]}
          </label>
        ))}
      </div>
      <p id="profile-sponsorblock-help" className="text-sm text-muted-foreground">
        Videos keep them, marked as chapters, and skip them when you watch here; audio-only profiles
        cut them out of the file. Only segments submitted before the download count.
      </p>
    </fieldset>
  );
}

/** Splits "--a b\n--c" into arguments on whitespace. */
const splitArgs = (text: string): string[] => text.split(/\s+/).filter((t) => t !== "");

/** Add or edit a format profile. The server checks the extra arguments against its allowlist. */
export function ProfileForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: FormatProfile;
  onSave: (body: NewFormatProfileBody) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [format, setFormat] = useState(initial?.format ?? "");
  const [mergeFormat, setMergeFormat] = useState(initial?.mergeFormat ?? "");
  const [audioOnly, setAudioOnly] = useState(initial?.audioOnly ?? false);
  const [audioFormat, setAudioFormat] = useState(initial?.audioFormat ?? "opus");
  const [extra, setExtra] = useState(initial?.extraArgs.join(" ") ?? "");
  const [cut, setCut] = useState<Set<SponsorBlockCategory>>(
    () => new Set(initial?.sponsorblockRemove ?? NEW_PROFILE_CUTS),
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      await onSave({
        name: name.trim(),
        format: format.trim(),
        mergeFormat: audioOnly || mergeFormat.trim() === "" ? null : mergeFormat.trim(),
        audioOnly,
        audioFormat: audioOnly ? audioFormat.trim() : null,
        extraArgs: splitArgs(extra),
        sponsorblockRemove: SPONSORBLOCK_CATEGORIES.filter((c) => cut.has(c)),
      });
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    hint?: string,
    mono = false,
  ) => (
    <Field
      id={id}
      label={label}
      value={value}
      mono={mono}
      help={hint}
      onChange={(e) => {
        set(e.target.value);
      }}
    />
  );
  return (
    <form className="grid gap-3.5" onSubmit={(e) => void submit(e)}>
      {field("profile-name", "Name", name, setName)}
      {field(
        "profile-format",
        "Format selector",
        format,
        setFormat,
        "yt-dlp's -f, e.g. bv*[height<=720]+ba/b",
        true,
      )}
      <label className="flex min-h-8 items-center gap-3">
        <Checkbox
          checked={audioOnly}
          onChange={(e) => {
            setAudioOnly(e.target.checked);
          }}
        />
        Audio only
      </label>
      {audioOnly
        ? field("profile-audio", "Audio format", audioFormat, setAudioFormat, "opus, m4a, mp3…")
        : field(
            "profile-merge",
            "Container",
            mergeFormat,
            setMergeFormat,
            "mp4, mkv… (empty: yt-dlp chooses)",
          )}
      {field(
        "profile-extra",
        "Extra yt-dlp arguments",
        extra,
        setExtra,
        "From the allowlist, e.g. --embed-chapters",
        true,
      )}
      <SponsorBlockFields value={cut} onChange={setCut} />
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
