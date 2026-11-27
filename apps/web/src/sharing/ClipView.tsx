import type { ClipItem } from "@uroboros/contract";
import { Download } from "lucide-react";
import { lazy, Suspense } from "react";

import { ProgressBar } from "@/components/ui/progress-bar";

import { SaveButton } from "../library/SaveButton";

const Player = lazy(() => import("../library/Player").then((m) => ({ default: m.Player })));

const nothing = () => undefined;

/**
 * A clip shared on its own (docs/sharing.md#clips), on its page or a public link's: its player once
 * the copy is made (how far it is until then, or why it couldn't be), its title, who shared it,
 * and Save when the share allows it. `link` registers a save link (the owner's own clip).
 */
export function ClipView({
  clip,
  link,
}: {
  clip: ClipItem;
  link?: ((token: string) => Promise<unknown>) | undefined;
}) {
  return (
    <article className="grid content-start gap-4">
      <div className="max-md:-mx-4">
        {clip.streamUrl !== null ? (
          <Suspense
            fallback={<div className="aspect-video w-full bg-raised md:rounded-[0.75rem]" />}
          >
            <Player
              src={clip.streamUrl}
              title={clip.title}
              start={0}
              autoPlay={false}
              seek={null}
              chapters={clip.chapters}
              subtitles={[]}
              onTime={nothing}
              onPause={nothing}
              onEnded={nothing}
              {...(clip.audioOnly ? { audio: { thumbnailUrl: clip.thumbnailUrl } } : {})}
            />
          </Suspense>
        ) : (
          <div className="grid aspect-video place-content-center gap-3 bg-raised px-6 text-center md:rounded-[0.75rem]">
            {clip.state === "failed" ? (
              <p className="text-destructive">
                This clip couldn't be made{clip.error === null ? "." : `: ${clip.error}`}
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">This clip is being made.</p>
                {clip.state === "running" ? (
                  <ProgressBar label="The clip" percent={(clip.progress ?? 0) * 100} />
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
      <h1 className="text-xl font-bold">{clip.title}</h1>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        {clip.channel === null ? null : <span>{clip.channel}</span>}
        {clip.owner === null ? null : <span>Shared by {clip.owner}</span>}
        {clip.fileUrl === null ? null : (
          <SaveButton
            variant="secondary"
            href={clip.fileUrl}
            {...(link === undefined ? {} : { link })}
          >
            <Download aria-hidden /> Save
          </SaveButton>
        )}
      </div>
    </article>
  );
}
