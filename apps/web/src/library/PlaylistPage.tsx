import { ExternalLink, SearchX } from "lucide-react";

import { useSources } from "@/api/library";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";

import { LibraryGrid } from "./LibraryGrid";

/** One playlist: the person's videos from it, in the playlist's order. */
export function PlaylistPage({ sourceId }: { sourceId: string }) {
  const source = useSources().data?.find((s) => s.id === sourceId);
  return (
    <section className="mx-auto grid w-full max-w-7xl gap-6">
      <PageHeader
        title={source?.title ?? "Playlist"}
        description={
          source === undefined ? undefined : `${String(source.count)} videos in your library`
        }
        action={
          source === undefined ? undefined : (
            <a
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              Open on the site <ExternalLink className="size-4" aria-hidden />
            </a>
          )
        }
      />
      <LibraryGrid
        filters={{ source: sourceId }}
        empty={
          <EmptyState icon={SearchX} title="Nothing from this playlist.">
            Its videos may have left your library.
          </EmptyState>
        }
      />
    </section>
  );
}
