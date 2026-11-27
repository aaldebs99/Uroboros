import type { ClipRange, Directory } from "@uroboros/contract";

import { useShareState } from "@/api/sharing";
import { Button } from "@/components/ui/button";
import { RadioChoice } from "@/components/ui/radio";
import { clipLabel, rangeQuery } from "@/library/clipRange";

import { useClipCopy } from "./clipTarget";
import { copyLink, LinkSection, useLinkBase } from "./LinkSection";
import { PeopleSection } from "./PeopleSection";

/** What a share with a clip picked holds (docs/sharing.md#clips). */
export type ClipScope = "clip" | "video";

/** The choice: only the clip, or the whole video opened at it. */
export function ShareScope({
  clip,
  scope,
  onChange,
}: {
  clip: ClipRange;
  scope: ClipScope;
  onChange: (scope: ClipScope) => void;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-bold">Share</legend>
      <RadioChoice
        name="share-scope"
        label={`Only the clip (${clipLabel(clip)})`}
        help="A copy of just that part: the rest of the video stays yours."
        checked={scope === "clip"}
        onPick={() => {
          onChange("clip");
        }}
      />
      <RadioChoice
        name="share-scope"
        label="The whole video, opened at the clip"
        help="They get the whole video; it starts at the clip and pauses at its end."
        checked={scope === "video"}
        onPick={() => {
          onChange("video");
        }}
      />
    </fieldset>
  );
}

/** How far the clip's copy is, in words. */
function copyStatus(copy: ReturnType<typeof useClipCopy>["copy"]): string {
  if (copy === null) return "Sharing it makes the clip, which they can watch once it's ready.";
  if (copy.state === "done") return "The clip is ready.";
  if (copy.state === "running") {
    return `Making the clip… ${String(Math.round((copy.progress ?? 0) * 100))}%`;
  }
  return "Making the clip…";
}

/** Sharing only the clip: its copy's people and link, the copy made at the first share action. */
export function ClipShareSections({
  entryId,
  clip,
  directory,
  open,
}: {
  entryId: string;
  clip: ClipRange;
  directory: Directory | undefined;
  open: boolean;
}) {
  const target = useClipCopy(entryId, clip);
  const id = target.copy?.id ?? null;
  const state = useShareState("clip", id ?? "", open && id !== null);
  const prepare = id === null ? target.ensure : undefined;
  return (
    <>
      <p className="text-sm text-muted-foreground">{copyStatus(target.copy)}</p>
      <PeopleSection
        kind="clip"
        id={id ?? ""}
        people={state.data?.people ?? null}
        directory={directory}
        prepare={prepare}
      />
      <LinkSection kind="clip" id={id ?? ""} link={state.data?.link ?? null} prepare={prepare} />
    </>
  );
}

/**
 * The whole video opened at the clip, for people it already reaches (they hear of no new share):
 * the address to send them, with Copy.
 */
export function ClipAddress({ entryId, clip }: { entryId: string; clip: ClipRange }) {
  const base = useLinkBase();
  const url = `${base}/library/${entryId}?${rangeQuery(clip)}`;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      People it already reaches hear of nothing new: send them the clip's address.
      <Button
        variant="ghost"
        size="compact"
        onClick={() => {
          copyLink(url);
        }}
      >
        Copy address
      </Button>
    </p>
  );
}
