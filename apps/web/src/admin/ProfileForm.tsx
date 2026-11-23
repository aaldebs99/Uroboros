import type { FormatProfile, NewFormatProfileBody } from "@uroboros/contract";
import { useState, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  ) => (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(e) => {
          set(e.target.value);
        }}
      />
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
  return (
    <form className="grid gap-3 rounded-lg border p-4" onSubmit={(e) => void submit(e)}>
      {field("profile-name", "Name", name, setName)}
      {field(
        "profile-format",
        "Format selector",
        format,
        setFormat,
        "yt-dlp's -f, e.g. bv*[height<=720]+ba/b",
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
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
      )}
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
