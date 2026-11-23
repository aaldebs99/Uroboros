import type { DownloadRequest } from "@uroboros/contract";
import { Download, Loader } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { submitDownload, useProfiles } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Paste a link and pick a format profile (the default is preselected). */
export function PasteForm({ onSubmitted }: { onSubmitted: (req: DownloadRequest) => void }) {
  const profiles = useProfiles();
  const [url, setUrl] = useState("");
  const [profileId, setProfileId] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const req = await submitDownload({
        url: url.trim(),
        ...(profileId === "" ? {} : { profileId }),
      });
      setUrl("");
      onSubmitted(req);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      onSubmit={(e) => void submit(e)}
    >
      <div className="grid gap-2">
        <Label htmlFor="download-url">Link</Label>
        <Input
          id="download-url"
          type="url"
          required
          placeholder="https://www.youtube.com/watch?v=…"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
          }}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="download-profile">Format</Label>
        <select
          id="download-profile"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value);
          }}
        >
          {(profiles.data ?? []).map((p) => (
            <option key={p.id} value={p.isDefault ? "" : p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? <Loader className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Download
      </Button>
      {problem ? (
        <p role="alert" className="text-sm text-destructive sm:col-span-3">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
