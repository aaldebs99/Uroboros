import type { DownloadRequest } from "@uroboros/contract";
import { Download, Loader } from "lucide-react";
import { useState, type SubmitEvent } from "react";

import { errorText } from "@/api/client";
import { submitDownload, useProfiles } from "@/api/downloads";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/field";

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
      className="grid gap-3 md:grid-cols-[1fr_16rem_auto] md:items-start"
      onSubmit={(e) => void submit(e)}
    >
      <Field
        label="Link"
        id="download-url"
        type="url"
        required
        placeholder="https://www.youtube.com/watch?v=…"
        value={url}
        error={problem}
        onChange={(e) => {
          setUrl(e.target.value);
        }}
      />
      <SelectField
        label="Format"
        id="download-profile"
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
      </SelectField>
      <Button type="submit" className="md:mt-1.5" disabled={busy}>
        {busy ? <Loader className="animate-spin" aria-hidden /> : <Download aria-hidden />}
        Download
      </Button>
    </form>
  );
}
