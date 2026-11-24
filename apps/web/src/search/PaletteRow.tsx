import type { PreviewEntry } from "@uroboros/contract";
import {
  Check,
  Download,
  ExternalLink,
  Film,
  Globe,
  LoaderCircle,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { formatDuration } from "@/downloads/format";
import { matchLabel, MatchSnippet } from "@/library/MatchLine";
import { VideoThumbnail } from "@/library/VideoTile";

import type { PaletteOption } from "./paletteOptions";
import type { ResultState } from "./useYouTubeSearch";

const iconBox =
  "grid size-9 shrink-0 place-items-center rounded-full bg-raised text-muted-foreground";

function Lines({
  title,
  meta,
  extra = null,
}: {
  title: string;
  meta: (string | null)[];
  /** A line under the meta (a search match's words). */
  extra?: ReactNode;
}) {
  const line = meta.filter((part) => part !== null && part !== "").join(" · ");
  return (
    <span className="grid min-w-0 flex-1">
      <span className="line-clamp-2 font-medium">{title}</span>
      {line === "" ? null : (
        <span className="truncate text-xs text-muted-foreground tabular-nums">{line}</span>
      )}
      {extra === null ? null : (
        <span className="truncate text-xs text-muted-foreground">{extra}</span>
      )}
    </span>
  );
}

/**
 * A result's thumbnail from the site itself. The app's content policy may refuse a remote image,
 * so a refused or broken one falls back to the film glyph.
 */
function RemoteThumbnail({ url }: { url: string | null }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className="relative grid aspect-video w-20 shrink-0 place-items-center overflow-hidden rounded-[0.5rem] bg-raised md:w-24">
      {url === null || broken ? (
        <Film className="size-5 text-muted-foreground" aria-hidden />
      ) : (
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          onError={() => {
            setBroken(true);
          }}
        />
      )}
    </span>
  );
}

function ResultEnd({ result, state }: { result: PreviewEntry; state: ResultState | undefined }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {state === "queueing" ? (
        <LoaderCircle className="size-4.5 animate-spin text-muted-foreground" aria-hidden />
      ) : state === "queued" ? (
        <span className="flex items-center gap-1 text-xs font-medium text-success">
          <Check className="size-4" aria-hidden /> Queued
        </span>
      ) : state === "have" ? (
        <span className="text-xs text-muted-foreground">In your library</span>
      ) : (
        <Download className="size-4.5 text-primary" aria-hidden />
      )}
      {/* For a pointer to look before downloading; keyboards download from the row itself. */}
      <a
        href={result.url}
        target="_blank"
        rel="noreferrer"
        tabIndex={-1}
        aria-hidden
        title="Open on YouTube"
        className="grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-raised hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <ExternalLink className="size-4" />
      </a>
    </span>
  );
}

/** What one option shows: a video (in the library or on YouTube), or one of the palette's actions. */
export function PaletteRow({
  option,
  state,
  pending,
}: {
  option: PaletteOption;
  /** A YouTube result's state, once chosen. */
  state?: ResultState | undefined;
  /** "Download this link" is under way. */
  pending?: boolean;
}) {
  switch (option.kind) {
    case "entry":
      return (
        <>
          <VideoThumbnail entry={option.entry} className="w-20 shrink-0 rounded-[0.5rem] md:w-24" />
          {/* The thumbnail's badge says how long it is; a search match, where it matched. */}
          <Lines
            title={option.entry.title}
            meta={[
              option.entry.channel,
              option.entry.match == null ? null : matchLabel(option.entry.match),
            ]}
            extra={option.entry.match == null ? null : <MatchSnippet match={option.entry.match} />}
          />
        </>
      );
    case "result":
      return (
        <>
          <RemoteThumbnail url={option.result.thumbnailUrl} />
          <Lines
            title={option.result.title ?? option.result.id}
            meta={[option.result.uploader, formatDuration(option.result.duration)]}
          />
          <ResultEnd result={option.result} state={state} />
        </>
      );
    case "all":
      return (
        <>
          <span className={iconBox}>
            <Search className="size-4.5" aria-hidden />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1">
            See all results for “{option.query}” in your library
          </span>
        </>
      );
    case "youtube":
      return (
        <>
          <span className={iconBox}>
            <Globe className="size-4.5" aria-hidden />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1">Search YouTube for “{option.query}”</span>
        </>
      );
    case "download":
      return (
        <>
          <span className={iconBox}>
            {pending === true ? (
              <LoaderCircle className="size-4.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-4.5" aria-hidden />
            )}
          </span>
          <span className="line-clamp-2 min-w-0 flex-1">
            {pending === true ? "Downloading…" : "Download this link"}
          </span>
        </>
      );
    case "format":
      return (
        <>
          <span className={iconBox}>
            <SlidersHorizontal className="size-4.5" aria-hidden />
          </span>
          <span className="line-clamp-2 min-w-0 flex-1">Choose a format…</span>
        </>
      );
  }
}
