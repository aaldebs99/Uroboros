import type { LibraryEntry } from "@uroboros/contract";
import { Download, Film, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { errorText } from "@/api/client";
import { useLibrary, useRemoveEntry } from "@/api/library";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDuration } from "@/downloads/format";

function EntryCard({ entry, onRemove }: { entry: LibraryEntry; onRemove: () => void }) {
  return (
    <li className="grid overflow-hidden rounded-lg border bg-card">
      <div className="grid aspect-video place-items-center bg-muted">
        {entry.thumbnailUrl === null ? (
          <Film className="size-8 text-muted-foreground" aria-hidden />
        ) : (
          <img src={entry.thumbnailUrl} alt="" loading="lazy" className="size-full object-cover" />
        )}
      </div>
      <div className="grid gap-1 p-3">
        <p className="line-clamp-2 font-medium">{entry.title}</p>
        <p className="text-xs text-muted-foreground">
          {[entry.channel, entry.uploadDate, formatDuration(entry.duration)]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <p className="text-xs text-muted-foreground">
          {entry.profileName} · {formatBytes(entry.sizeBytes)}
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" asChild>
            <a href={`/api/library/${entry.id}/file`} download aria-label="Save">
              <Download aria-hidden /> Save
            </a>
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 aria-hidden /> Remove
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Library: everything the person has downloaded (one shared file per video and profile). */
export function LibraryPage() {
  const library = useLibrary();
  const remove = useRemoveEntry();
  const onRemove = (entry: LibraryEntry) => {
    if (!window.confirm(`Remove "${entry.title}" from your library?`)) return;
    remove.mutate(entry.id, { onError: (err) => toast.error(errorText(err)) });
  };
  const entries = library.data ?? [];
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-6">
      <div>
        <h1 className="text-3xl font-semibold">Library</h1>
        <p className="mt-1 text-muted-foreground">Everything you have downloaded, in one place.</p>
      </div>
      {library.isError ? (
        <p className="text-sm text-destructive">{errorText(library.error)}</p>
      ) : null}
      {library.isSuccess && entries.length === 0 ? (
        <div className="grid gap-2 text-sm text-muted-foreground">
          <p>Nothing here yet.</p>
          <a href="/downloads" className="text-primary hover:underline">
            Go to Downloads
          </a>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4">
          {entries.map((e) => (
            <EntryCard
              key={e.id}
              entry={e}
              onRemove={() => {
                onRemove(e);
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
