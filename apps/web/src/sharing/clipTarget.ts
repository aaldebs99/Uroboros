import { answersClip, type ClipRange, type Export, roundClip } from "@uroboros/contract";

import { ApiError } from "@/api/client";
import { useExports, useStartExport } from "@/api/exports";

/**
 * The copy a clip shared on its own is (docs/sharing.md#clips): the person's copy of that range of
 * the video, once asked for. `ensure` asks for it at the first share action (never just by opening
 * the dialog), and refuses an answer of another range or none: an older server, which knows no
 * clips, would make a copy without sponsors instead. A clip asked to run a hair past the file's end
 * is that copy ended at the end (`answersClip`).
 */
export function useClipCopy(entryId: string, clip: ClipRange) {
  const asked = roundClip(clip);
  const copies = useExports(true);
  const start = useStartExport();
  const same = (c: Export) => answersClip(asked, c);
  // A failed one is asked for again, which makes it again in its own row.
  const copy =
    copies.data?.find((c) => c.entryId === entryId && same(c) && c.state !== "failed") ?? null;
  const ensure = async (): Promise<string> => {
    if (copy !== null) return copy.id;
    const made = await start.mutateAsync({ entryId, clip: asked });
    if (!same(made)) {
      const message = "This server couldn't make the clip: it may not have been updated yet.";
      throw new ApiError(409, message, { code: "conflict", message });
    }
    return made.id;
  };
  return { copy, ensure };
}
